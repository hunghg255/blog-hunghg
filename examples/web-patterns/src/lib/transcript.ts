/**
 * Phụ đề và transcript tương tác.
 *
 * Phần 1 - kiểm tra file WebVTT trước khi upload (ý tưởng từ caption/vtt-file-validator.js của
 * Udemy): báo TẤT CẢ lỗi kèm số dòng thay vì dừng ở lỗi đầu, sửa vài chỗ bản gốc bỏ sót.
 *
 * Phần 2 - bôi chọn trên transcript (ý tưởng từ TranscriptHighlighterUtils của Coursera): lưu
 * vùng chọn theo toạ độ { cueIndex, offset } thay vì theo DOM node, nên highlight sống sót qua
 * re-render; đổi qua lại giữa toạ độ này và Selection/Range của trình duyệt.
 */

// ======================= Phần 1: WebVTT =======================

export interface Cue {
  index: number;
  id?: string;
  /** mili giây */
  start: number;
  end: number;
  text: string;
  /** dòng (bắt đầu từ 1) của dòng timing trong file */
  line: number;
}

export type VttErrorCode =
  | 'NO_CONTENT'
  | 'MISSING_HEADER'
  | 'MISSING_TIMINGS'
  | 'BAD_TIMESTAMP'
  | 'END_BEFORE_START'
  | 'MISSING_TEXT'
  | 'EMPTY_TEXT'
  | 'SEPARATOR_IN_TEXT'
  | 'OUT_OF_ORDER'
  | 'START_AFTER_VIDEO_END'
  | 'NO_CUES';

export interface VttIssue {
  code: VttErrorCode;
  line: number;
  message: string;
}

const MESSAGES: Record<VttErrorCode, string> = {
  NO_CONTENT: 'File rỗng.',
  MISSING_HEADER: 'Dòng đầu phải là WEBVTT.',
  MISSING_TIMINGS: 'Có chữ nhưng thiếu dòng thời gian "00:00:01.000 --> 00:00:03.000".',
  BAD_TIMESTAMP: 'Thời gian sai định dạng (cần [hh:]mm:ss.ttt, phút và giây từ 00 tới 59).',
  END_BEFORE_START: 'Thời điểm kết thúc phải sau thời điểm bắt đầu.',
  MISSING_TEXT: 'Có thời gian nhưng không có chữ.',
  EMPTY_TEXT: 'Chỉ có thẻ định dạng, không có chữ.',
  SEPARATOR_IN_TEXT: 'Chữ phụ đề không được chứa "-->".',
  OUT_OF_ORDER: 'Thời điểm bắt đầu nhỏ hơn cue phía trên (cue phải xếp theo thời gian).',
  START_AFTER_VIDEO_END: 'Cue bắt đầu sau khi video đã hết.',
  NO_CUES: 'Không có cue nào.',
};

// [hh:]mm:ss.ttt theo spec: giờ ≥ 2 chữ số, phút/giây đúng 2 chữ số, mili giây đúng 3 chữ số
const TIMESTAMP = /^(?:(\d{2,}):)?(\d{2}):(\d{2})\.(\d{3})$/;

/** "01:02:03.456" -> 3723456 (ms). Trả null nếu sai định dạng. Regex chỉ nhận chữ số nên không lọt "0x1f" hay "1e3". */
export function parseTimestamp(value: string): number | null {
  const m = TIMESTAMP.exec(value.trim());
  if (!m) return null;
  const [, h = '0', mm, ss, ms] = m;
  const minutes = Number(mm);
  const seconds = Number(ss);
  if (minutes > 59 || seconds > 59) return null;
  return ((Number(h) * 60 + minutes) * 60 + seconds) * 1000 + Number(ms);
}

export function formatTimestamp(ms: number): string {
  const pad = (n: number, w = 2) => String(Math.floor(n)).padStart(w, '0');
  return `${pad(ms / 3_600_000)}:${pad((ms / 60_000) % 60)}:${pad((ms / 1000) % 60)}.${pad(ms % 1000, 3)}`;
}

const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&nbsp;': ' ', '&lrm;': '', '&rlm;': '' };

/** Bỏ thẻ <b>, <v Tên>, <00:00:01.000>… và entity, còn lại là chữ người xem thấy. */
export function cueTextToPlain(text: string): string {
  return text.replace(/<[^>]*>/g, '').replace(/&(?:amp|lt|gt|nbsp|lrm|rlm);/g, (e) => ENTITIES[e]);
}

export interface ValidateOptions {
  /** độ dài video (giây), nếu biết */
  videoLength?: number;
}

export function validateWebVTT(input: string, { videoLength }: ValidateOptions = {}) {
  const issues: VttIssue[] = [];
  const cues: Cue[] = [];
  const report = (code: VttErrorCode, line: number) => issues.push({ code, line, message: MESSAGES[code] });

  if (input.trim().length === 0) {
    report('NO_CONTENT', 1);
    return { cues, issues };
  }

  // spec cho phép CRLF, LF và CR đứng một mình
  const lines = input.replace(/\r\n?/g, '\n').split('\n');
  if (!/^﻿?WEBVTT(?:$|[ \t])/.test(lines[0])) report('MISSING_HEADER', 1);

  // gom các dòng thành block, ngăn cách bởi dòng trống; nhớ số dòng bắt đầu của block
  const blocks: Array<{ start: number; lines: string[] }> = [];
  let current: { start: number; lines: string[] } | null = null;
  lines.forEach((line, i) => {
    if (line.trim() === '') {
      current = null;
      return;
    }
    if (!current) {
      current = { start: i + 1, lines: [] };
      blocks.push(current);
    }
    current.lines.push(line);
  });

  let previousStart = -1;
  // block đầu tiên là header (WEBVTT + metadata), bỏ qua
  for (const block of blocks.slice(1)) {
    // NOTE/STYLE/REGION phải nằm ở ĐẦU block. Bản gốc viết /^NOTE|STYLE|REGION/ nên một cue có
    // chữ "STYLE" ở bất kỳ đâu cũng bị bỏ qua, không được kiểm tra.
    if (/^(?:NOTE|STYLE|REGION)(?:$|[ \t])/.test(block.lines[0])) continue;

    const timingAt = block.lines[0].includes('-->') ? 0 : block.lines[1]?.includes('-->') ? 1 : -1;
    if (timingAt === -1) {
      report('MISSING_TIMINGS', block.start);
      continue;
    }
    const timingLine = block.start + timingAt;
    const [rawStart, rest = ''] = block.lines[timingAt].split(/[ \t]+-->[ \t]+/);
    const start = parseTimestamp(rawStart);
    // sau thời điểm kết thúc có thể có cue settings: "00:01.000 --> 00:02.000 align:start"
    const end = parseTimestamp(rest.split(/[ \t]/)[0] ?? '');
    const payload = block.lines.slice(timingAt + 1);

    if (start === null || end === null) {
      report('BAD_TIMESTAMP', timingLine);
      continue;
    }
    if (end <= start) report('END_BEFORE_START', timingLine);
    if (start < previousStart) report('OUT_OF_ORDER', timingLine);
    if (videoLength !== undefined && start > videoLength * 1000) report('START_AFTER_VIDEO_END', timingLine);

    if (payload.length === 0) report('MISSING_TEXT', timingLine);
    else if (payload.some((l) => l.includes('-->'))) report('SEPARATOR_IN_TEXT', timingLine + 1);
    else if (cueTextToPlain(payload.join('\n')).trim() === '') report('EMPTY_TEXT', timingLine + 1);

    previousStart = Math.max(previousStart, start);
    cues.push({
      index: cues.length,
      id: timingAt === 1 ? block.lines[0] : undefined,
      start,
      end,
      text: cueTextToPlain(payload.join(' ')),
      line: timingLine,
    });
  }

  if (cues.length === 0 && !issues.some((i) => i.code !== 'MISSING_HEADER')) report('NO_CUES', lines.length);
  return { cues, issues };
}

// ======================= Phần 2: vùng chọn trên transcript =======================

/** Một điểm trong transcript: cue thứ mấy, ký tự thứ mấy trong chữ của cue đó. */
export interface TextPoint {
  cueIndex: number;
  offset: number;
}

/** Vùng chọn, `end` không tính (giống String.slice). */
export interface TextSpan {
  start: TextPoint;
  end: TextPoint;
}

export const CUE_ATTR = 'data-cue-index';

export function comparePoints(a: TextPoint, b: TextPoint): number {
  return a.cueIndex - b.cueIndex || a.offset - b.offset;
}

function cueElementOf(node: Node, root: HTMLElement): HTMLElement | null {
  const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  const cue = el?.closest<HTMLElement>(`[${CUE_ATTR}]`) ?? null;
  return cue && root.contains(cue) ? cue : null;
}

/**
 * Đổi (node, offset) của trình duyệt thành toạ độ của cue. Offset của Selection tính trong
 * TỪNG text node; nếu cue đã có <mark> thì chữ bị chia thành nhiều text node, nên phải đo
 * độ dài từ đầu cue tới điểm đó (Range.toString), không dùng thẳng anchorOffset.
 */
export function pointFromDom(node: Node, offset: number, root: HTMLElement): TextPoint | null {
  const cueEl = cueElementOf(node, root);
  if (!cueEl) return null;
  const range = document.createRange();
  range.setStart(cueEl, 0);
  range.setEnd(node, offset);
  return { cueIndex: Number(cueEl.getAttribute(CUE_ATTR)), offset: range.toString().length };
}

export function spanFromSelection(selection: Selection | null, root: HTMLElement): TextSpan | null {
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0); // Range luôn có start trước end, dù người dùng kéo ngược
  const start = pointFromDom(range.startContainer, range.startOffset, root);
  const end = pointFromDom(range.endContainer, range.endOffset, root);
  if (!start || !end || comparePoints(start, end) >= 0) return null;
  return { start, end };
}

/** Ngược lại: từ toạ độ cue tìm text node và offset trong node đó. */
export function domFromPoint(point: TextPoint, root: HTMLElement): { node: Node; offset: number } | null {
  const cueEl = root.querySelector(`[${CUE_ATTR}="${point.cueIndex}"]`);
  if (!cueEl) return null;
  const walker = document.createTreeWalker(cueEl, NodeFilter.SHOW_TEXT);
  let remaining = point.offset;
  let last: Text | null = null;
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    if (remaining <= node.length) return { node, offset: remaining };
    remaining -= node.length;
    last = node;
  }
  return last ? { node: last, offset: last.length } : { node: cueEl, offset: 0 };
}

export function applySpanToSelection(span: TextSpan, root: HTMLElement, selection = window.getSelection()) {
  const a = domFromPoint(span.start, root);
  const b = domFromPoint(span.end, root);
  if (!a || !b || !selection) return;
  const range = document.createRange();
  range.setStart(a.node, a.offset);
  range.setEnd(b.node, b.offset);
  selection.removeAllRanges();
  selection.addRange(range);
}

/** Vị trí đầu và cuối các "từ" trong chữ, theo Intl.Segmenter (đúng cả tiếng Việt, Nhật…). */
export function wordEdges(text: string, locale = 'vi'): { starts: number[]; ends: number[] } {
  const starts: number[] = [];
  const ends: number[] = [];
  for (const s of new Intl.Segmenter(locale, { granularity: 'word' }).segment(text)) {
    if (!s.isWordLike) continue;
    starts.push(s.index);
    ends.push(s.index + s.segment.length);
  }
  return { starts, ends };
}

/**
 * Dịch một điểm sang từ kế tiếp (sang phải: tới CUỐI từ tiếp theo; sang trái: về ĐẦU từ trước),
 * nhảy qua cue bên cạnh khi đã ở mép. Làm trên chuỗi chữ của cue nên không phải đi cây DOM.
 */
export function moveByWord(point: TextPoint, direction: 'left' | 'right', cues: readonly string[], locale = 'vi'): TextPoint {
  let { cueIndex, offset } = point;
  for (;;) {
    const { starts, ends } = wordEdges(cues[cueIndex] ?? '', locale);
    if (direction === 'right') {
      const next = ends.find((e) => e > offset);
      if (next !== undefined) return { cueIndex, offset: next };
      if (cueIndex >= cues.length - 1) return { cueIndex, offset: (cues[cueIndex] ?? '').length };
      cueIndex += 1;
      offset = 0;
    } else {
      const prev = [...starts].reverse().find((s) => s < offset);
      if (prev !== undefined) return { cueIndex, offset: prev };
      if (cueIndex <= 0) return { cueIndex: 0, offset: 0 };
      cueIndex -= 1;
      offset = (cues[cueIndex] ?? '').length;
    }
  }
}

/** Dịch một điểm tới đầu/cuối cue (kiểu "phrase" của Coursera). */
export function moveByCue(point: TextPoint, direction: 'left' | 'right', cues: readonly string[]): TextPoint {
  const len = (i: number) => (cues[i] ?? '').length;
  if (direction === 'right') {
    if (point.offset < len(point.cueIndex)) return { cueIndex: point.cueIndex, offset: len(point.cueIndex) };
    const next = Math.min(point.cueIndex + 1, cues.length - 1);
    return { cueIndex: next, offset: len(next) };
  }
  if (point.offset > 0) return { cueIndex: point.cueIndex, offset: 0 };
  return { cueIndex: Math.max(point.cueIndex - 1, 0), offset: 0 };
}

export interface Piece {
  text: string;
  highlightId?: string;
}

/** Cắt chữ một cue thành các đoạn thường / đoạn được bôi, để render <mark>. */
export function piecesForCue(cueIndex: number, text: string, highlights: ReadonlyArray<TextSpan & { id: string }>): Piece[] {
  const marks = highlights
    .filter((h) => h.start.cueIndex <= cueIndex && h.end.cueIndex >= cueIndex)
    .map((h) => ({
      id: h.id,
      from: h.start.cueIndex === cueIndex ? h.start.offset : 0,
      to: h.end.cueIndex === cueIndex ? h.end.offset : text.length,
    }))
    .filter((m) => m.to > m.from)
    .sort((a, b) => a.from - b.from);

  const pieces: Piece[] = [];
  let cursor = 0;
  for (const m of marks) {
    const from = Math.max(m.from, cursor); // các highlight chồng nhau: đoạn sau bắt đầu từ chỗ đoạn trước dừng
    if (from > cursor) pieces.push({ text: text.slice(cursor, from) });
    if (m.to > from) pieces.push({ text: text.slice(from, m.to), highlightId: m.id });
    cursor = Math.max(cursor, m.to);
  }
  if (cursor < text.length) pieces.push({ text: text.slice(cursor) });
  return pieces;
}
