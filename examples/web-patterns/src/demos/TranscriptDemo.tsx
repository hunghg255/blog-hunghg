import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import {
  CUE_ATTR,
  applySpanToSelection,
  cueTextToPlain,
  formatTimestamp,
  moveByCue,
  moveByWord,
  piecesForCue,
  spanFromSelection,
  validateWebVTT,
  type TextSpan,
} from '../lib/transcript';
import { Log, useLog } from './shared';
import './TranscriptDemo.css';

// ---------- phần 1: kiểm tra file ----------

const BAD_FILE = `WEBVTT
Kind: captions

1
00:00:01.000 --> 00:00:03.500
Xin chào, hôm nay học về Intl.

2
00:00:04.000 --> 00:00:03.000
Cue có thời gian kết thúc trước bắt đầu.

3
00:00:06.000 --> 00:00:08.000
STYLE của nút: viền --> bo góc

4
00:00:05.000 --> 00:00:07.000
Cue bắt đầu sớm hơn cue phía trên.

5
00:01:75.000 --> 00:01:80.000
Giây 75 là sai định dạng.`;

const MISSED_FILE = `WEBVTT

00:00:01.000 --> 00:00:03.500
Xin chào, hôm nay học về Intl.

00:00:04.000 --> 00:00:06.000
STYLE của nút: viền --> bo góc

00:00:02.000 --> 00:00:01:75.000
Cue có giây 75 và nằm sau chữ STYLE.`;

const GOOD_FILE = `WEBVTT

00:00:01.000 --> 00:00:03.500
Xin chào, hôm nay học về Intl.

00:00:04.000 --> 00:00:06.000
Chỉ cần API có sẵn của trình duyệt.`;

/**
 * Mô phỏng thứ tự kiểm tra của validator gốc (Udemy) để so sánh: dừng ở lỗi đầu tiên,
 * và nhận diện NOTE/STYLE/REGION bằng /^NOTE|STYLE|REGION/ như bản gốc.
 */
function legacyValidate(text: string): string {
  if (text.length === 0) return 'NO_CONTENT';
  const [header, ...blocks] = text.split(/(?:\r\n|\n){2,}/);
  if (!/^﻿?WEBVTT(:?$|[ \t])/.test(header.split(/\r\n|\n/)[0])) return 'MISSING_WEBVTT_HEADER';
  const timings = /\b[ \t]+-->[ \t]+\b/;
  const parse = (t: string) => {
    const u = t.split(':').reverse();
    if (!/\.\d{3}$/.test(u[0]) || /[a-z]/i.test(u[0])) return NaN;
    const minutes = u[1] ? Math.floor(Number(u[1])) : 0;
    if (minutes < 0 || minutes > 59) return NaN; // giây không bị giới hạn, giống bản gốc
    return Number(u[0]) * 1000 + minutes * 60000 + (u[2] ? Number(u[2]) * 3600000 : 0);
  };
  for (const block of blocks) {
    if (!block) continue;
    if (/^NOTE|STYLE|REGION/.test(block)) continue; // "STYLE" ở bất kỳ đâu cũng bị coi là block STYLE
    const ls = block.split(/\r\n|\n/);
    const at = timings.test(ls[0]) ? 0 : timings.test(ls[1] ?? '') ? 1 : -1;
    if (at < 0) return 'MISSING_TIMINGS';
    const payload = ls.slice(at + 1);
    if (!payload[0]?.trim()) return 'MISSING_TRACK_TEXT';
    if (!cueTextToPlain(payload[0]).trim()) return 'EMPTY_TRACK_TEXT';
    if (/-->/.test(payload[0])) return 'SEPARATOR_IN_TRACK_TEXT';
    const [a, b] = ls[at].split(timings);
    const start = parse(a);
    const end = parse(b.split(/[ \t]/)[0]);
    if (Number.isNaN(start) || Number.isNaN(end)) return 'BAD_TIME_OFFSET';
    if (start >= end) return 'SINGLE_TIMING_END_BEFORE_START';
  }
  return 'OK';
}

function ValidatorPanel() {
  const [text, setText] = useState(BAD_FILE);
  const legacy = legacyValidate(text);
  const { issues, cues } = validateWebVTT(text, { videoLength: 90 });
  return (
    <section className='tr-section'>
      <h2>1. Kiểm tra file .vtt trước khi upload</h2>
      <div className='toolbar'>
        <button onClick={() => setText(BAD_FILE)}>File có lỗi</button>
        <button onClick={() => setText(MISSED_FILE)}>Lỗi bị bỏ sót</button>
        <button onClick={() => setText(GOOD_FILE)}>File đúng</button>
      </div>
      <div className='tr-validator'>
        <textarea value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} aria-label='Nội dung file WebVTT' />
        <div className='tr-results'>
          <div className='card'>
            <div className='tr-label'>Kiểu Udemy: dừng ở lỗi đầu tiên</div>
            <b className={legacy === 'OK' ? 'ok' : 'err'}>{legacy}</b>
          </div>
          <div className='card'>
            <div className='tr-label'>
              validateWebVTT: {issues.length} lỗi, {cues.length} cue
            </div>
            {issues.length === 0 ? (
              <b className='ok'>Hợp lệ</b>
            ) : (
              <ul className='tr-issues'>
                {issues.map((issue, i) => (
                  <li key={i}>
                    <span className='tr-line'>dòng {issue.line}</span> <code>{issue.code}</code> {issue.message}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

// ---------- phần 2: transcript ----------

const LECTURE = `WEBVTT

00:00:00.000 --> 00:00:04.000
Chào mừng các bạn quay lại khoá học.

00:00:04.000 --> 00:00:08.500
Hôm nay ta tìm hiểu cách trình duyệt chọn chữ.

00:00:08.500 --> 00:00:13.000
Mỗi vùng chọn có một điểm neo và một điểm focus.

00:00:13.000 --> 00:00:17.000
Offset của chúng tính trong từng text node.

00:00:17.000 --> 00:00:21.500
Vì vậy đừng lưu offset thô vào cơ sở dữ liệu.`;

interface Highlight extends TextSpan {
  id: string;
  text: string;
}

let nextId = 1;

function TranscriptPanel() {
  const cues = useMemo(() => validateWebVTT(LECTURE).cues, []);
  const cueTexts = useMemo(() => cues.map((c) => c.text), [cues]);
  const rootRef = useRef<HTMLDivElement>(null);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [span, setSpan] = useState<TextSpan | null>(null);
  const [rawInfo, setRawInfo] = useState('');
  const [renderKey, setRenderKey] = useState(0);
  const [large, setLarge] = useState(false);
  const { lines, add } = useLog(12);

  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => setTime((t) => (t + 250 > 21500 ? 0 : t + 250)), 250);
    return () => window.clearInterval(id);
  }, [playing]);

  const active = cues.findIndex((c) => time >= c.start && time < c.end);

  const readSelection = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    const selection = window.getSelection();
    const next = spanFromSelection(selection, root);
    setSpan(next);
    if (next && selection) {
      // giá trị "thô" mà bản gốc lưu: anchorOffset tính trong text node, không phải trong cue
      setRawInfo(`offset thô: ${selection.anchorOffset} → ${selection.focusOffset}`);
    } else {
      setRawInfo('');
    }
  }, []);

  useEffect(() => {
    document.addEventListener('selectionchange', readSelection);
    return () => document.removeEventListener('selectionchange', readSelection);
  }, [readSelection]);

  const addHighlight = () => {
    if (!span) return;
    const text = cueTexts
      .slice(span.start.cueIndex, span.end.cueIndex + 1)
      .map((t, i, all) => t.slice(i === 0 ? span.start.offset : 0, i === all.length - 1 ? span.end.offset : t.length))
      .join(' ');
    setHighlights((h) => [...h, { ...span, id: `h${nextId++}`, text }]);
    add(
      `Lưu highlight: cue ${span.start.cueIndex}:${span.start.offset} → cue ${span.end.cueIndex}:${span.end.offset}`,
      'ok',
    );
    window.getSelection()?.removeAllRanges();
  };

  /** Alt + mũi tên: mở rộng vùng chọn theo từ (←/→) hoặc theo cue (↑/↓); thêm Shift để thu lại. */
  const onKeyDown = (event: KeyboardEvent) => {
    if (!event.altKey || !rootRef.current) return;
    const keys: Record<string, ['left' | 'right', 'word' | 'cue']> = {
      ArrowRight: ['right', 'word'],
      ArrowLeft: ['left', 'word'],
      ArrowDown: ['right', 'cue'],
      ArrowUp: ['left', 'cue'],
    };
    const action = keys[event.key];
    if (!action) return;
    event.preventDefault();
    const [direction, unit] = action;
    const move = (p: TextSpan['start'], d: 'left' | 'right') =>
      unit === 'word' ? moveByWord(p, d, cueTexts) : moveByCue(p, d, cueTexts);
    // đọc vùng chọn ngay lúc bấm phím: state `span` cập nhật qua selectionchange (bất đồng bộ)
    // nên bấm liên tiếp sẽ đọc phải giá trị cũ
    const fallback = { cueIndex: Math.max(active, 0), offset: 0 };
    const current = spanFromSelection(window.getSelection(), rootRef.current) ?? { start: fallback, end: fallback };
    let next: TextSpan;
    if (!event.shiftKey) {
      // mở rộng: → kéo đầu cuối sang phải, ← kéo đầu trước sang trái
      next = direction === 'right' ? { ...current, end: move(current.end, 'right') } : { ...current, start: move(current.start, 'left') };
    } else {
      // thu lại: ← kéo đầu cuối về trái, → kéo đầu trước sang phải
      next = direction === 'left' ? { ...current, end: move(current.end, 'left') } : { ...current, start: move(current.start, 'right') };
    }
    applySpanToSelection(next, rootRef.current);
  };

  const seek = (index: number) => {
    // click để chọn chữ thì đừng tua video
    if (window.getSelection()?.isCollapsed === false) return;
    setTime(cues[index].start);
    add(`Tua tới ${formatTimestamp(cues[index].start)}`);
  };

  return (
    <section className='tr-section'>
      <h2>2. Bôi chọn trên transcript</h2>
      <div className='toolbar'>
        <button className='primary' onClick={() => setPlaying((p) => !p)}>
          {playing ? '⏸ Dừng' : '▶ Phát'}
        </button>
        <span className='tr-time'>{formatTimestamp(time)}</span>
        <button onClick={addHighlight} disabled={!span}>
          🖍 Bôi vàng vùng chọn
        </button>
        <button
          onClick={() => {
            setRenderKey((k) => k + 1);
            setLarge((l) => !l);
            add('Render lại toàn bộ transcript (DOM mới, cỡ chữ khác)', 'muted');
          }}
        >
          ↻ Render lại
        </button>
        <button onClick={() => setHighlights([])} disabled={highlights.length === 0}>
          Xoá highlight
        </button>
      </div>
      <p className='hint'>
        Bôi chọn bằng chuột, hoặc bấm vào transcript rồi dùng <kbd>Alt</kbd>+<kbd>→</kbd>/<kbd>←</kbd> (theo từ),{' '}
        <kbd>Alt</kbd>+<kbd>↓</kbd>/<kbd>↑</kbd> (theo cue), thêm <kbd>Shift</kbd> để thu lại.
      </p>
      <div
        key={renderKey}
        ref={rootRef}
        className={`tr-transcript${large ? ' large' : ''}`}
        tabIndex={0}
        onKeyDown={onKeyDown}
        aria-label='Transcript bài giảng'
      >
        {cues.map((cue, i) => (
          <span key={cue.index}>
            <span
              {...{ [CUE_ATTR]: cue.index }}
              className={`tr-cue${i === active ? ' active' : ''}`}
              onClick={() => seek(i)}
              title={formatTimestamp(cue.start)}
            >
              {piecesForCue(cue.index, cue.text, highlights).map((p, j) =>
                p.highlightId ? <mark key={j}>{p.text}</mark> : <span key={j}>{p.text}</span>,
              )}
            </span>{' '}
          </span>
        ))}
      </div>
      <div className='tr-status'>
        {span ? (
          <>
            <span className='ok'>
              Vùng chọn: cue {span.start.cueIndex}:{span.start.offset} → cue {span.end.cueIndex}:{span.end.offset}
            </span>{' '}
            <span className='muted'>({rawInfo})</span>
          </>
        ) : (
          <span className='muted'>Chưa chọn chữ trong transcript</span>
        )}
      </div>
      <ul className='tr-highlights'>
        {highlights.map((h) => (
          <li key={h.id}>
            <mark>{h.text}</mark>{' '}
            <span className='muted'>
              {h.start.cueIndex}:{h.start.offset} → {h.end.cueIndex}:{h.end.offset}
            </span>
          </li>
        ))}
      </ul>
      <Log lines={lines} />
    </section>
  );
}

export default function TranscriptDemo() {
  return (
    <div className='page transcript-demo'>
      <h1>WebVTT và transcript tương tác</h1>
      <ValidatorPanel />
      <TranscriptPanel />
    </div>
  );
}
