/**
 * Hai cách tìm segment DASH mà không cần manifest liệt kê hết:
 * 1. SegmentTimeline kèm "predicted media" (kiểu oz-player của Facebook): đoán URL segment kế tiếp
 *    của luồng live trước khi manifest kịp cập nhật.
 * 2. Hộp sidx của MP4 (ISO-BMFF): đọc bảng byte-range/thời gian của từng segment từ chính file.
 * Viết lại từ đầu.
 */

export interface TimelineEntry {
  /** Thời điểm bắt đầu (đơn vị timescale). */
  t: number;
  /** Thời lượng (đơn vị timescale). */
  d: number;
  /** Số lần lặp thêm (DASH @r). Bản gốc yêu cầu r = 0. */
  r?: number;
}

export interface PredictedTimelineInfo {
  timescale: number;
  /** Template URL của segment đã có, ví dụ "seg-$Number$.m4s". */
  media: string;
  entries: TimelineEntry[];
  /** Template URL cho segment CHƯA có trong manifest (FBPredictedMedia). */
  predictedMedia?: string;
  /** Số thứ tự segment đầu tiên còn trên server (FBPredictedMediaStartNumber). */
  startNumber?: number;
  /** Số thứ tự của entry cuối trong timeline (FBPredictedMediaEndNumber). */
  endNumber?: number;
  /** Thời lượng trung bình một segment, đơn vị timescale (FBAverageDuration). */
  averageDuration?: number;
}

export interface SegmentRef {
  number: number | null;
  url: string;
  /** Giây. Segment dự đoán chưa biết thời lượng thì start = end = NaN. */
  start: number;
  end: number;
  predicted: boolean;
}

const int = (v: string | null | undefined) => (v == null || v === '' ? undefined : Number.parseInt(v, 10));

/** Đọc <SegmentTemplate> chứa <SegmentTimeline> từ chuỗi XML (cần DOMParser: trình duyệt hoặc jsdom). */
export function parseSegmentTemplate(xml: string): PredictedTimelineInfo {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const tpl = doc.getElementsByTagName('SegmentTemplate')[0];
  const tl = tpl?.getElementsByTagName('SegmentTimeline')[0];
  if (!tpl || !tl) throw new Error('Thiếu SegmentTemplate/SegmentTimeline');
  const entries: TimelineEntry[] = [];
  let next = 0;
  for (const s of Array.from(tl.getElementsByTagName('S'))) {
    const t = int(s.getAttribute('t')) ?? next; // @t vắng mặt: nối tiếp entry trước
    const d = int(s.getAttribute('d'))!;
    const r = int(s.getAttribute('r')) ?? 0;
    entries.push({ t, d, r });
    next = t + d * (r + 1);
  }
  return {
    timescale: int(tpl.getAttribute('timescale')) ?? 1,
    media: tpl.getAttribute('media') ?? '',
    entries,
    predictedMedia: tl.getAttribute('FBPredictedMedia') ?? undefined,
    startNumber: int(tl.getAttribute('FBPredictedMediaStartNumber')),
    endNumber: int(tl.getAttribute('FBPredictedMediaEndNumber')),
    averageDuration: int(tl.getAttribute('FBAverageDuration')),
  };
}

export const fillTemplate = (template: string, number: number, time?: number) =>
  template
    .replace(/\$Number(?:%0(\d+)d)?\$/g, (_, w) => String(number).padStart(Number(w ?? 0), '0'))
    .replace(/\$Time\$/g, String(time ?? ''));

/** Trải @r ra thành từng segment, đánh số sao cho entry cuối mang số endNumber. */
function expand(info: PredictedTimelineInfo) {
  const flat: { t: number; d: number }[] = [];
  for (const e of info.entries) for (let i = 0; i <= (e.r ?? 0); i++) flat.push({ t: e.t + i * e.d, d: e.d });
  const last = info.endNumber ?? flat.length;
  return flat.map((s, i) => ({ ...s, number: last - (flat.length - 1 - i) }));
}

export class PredictedTimeline {
  private readonly flat: { t: number; d: number; number: number }[];

  constructor(private readonly info: PredictedTimelineInfo) {
    this.flat = expand(info);
  }

  get canPredict(): boolean {
    return !!this.info.predictedMedia && this.info.endNumber != null;
  }

  private ref(s: { t: number; d: number; number: number }): SegmentRef {
    const ts = this.info.timescale;
    return { number: s.number, url: fillTemplate(this.info.media, s.number, s.t), start: s.t / ts, end: (s.t + s.d) / ts, predicted: false };
  }

  /** Khoảng thời gian manifest này phủ, tính cả phần trước cửa sổ timeline nếu biết startNumber. */
  timeRange(): { start: number; end: number } | null {
    if (this.flat.length === 0) return null;
    const ts = this.info.timescale;
    const first = this.flat[0];
    const last = this.flat[this.flat.length - 1];
    const { startNumber, averageDuration } = this.info;
    const before = startNumber != null && averageDuration ? Math.max(0, first.number - startNumber) * averageDuration : 0;
    return { start: (first.t - before) / ts, end: (last.t + last.d) / ts };
  }

  /** Segment chứa thời điểm `sec`. Trước cửa sổ timeline thì ước lượng số theo thời lượng trung bình. */
  segmentAt(sec: number): SegmentRef | null {
    const ts = this.info.timescale;
    const x = sec * ts;
    const hit = this.flat.find((s) => s.t <= x && x < s.t + s.d);
    if (hit) return this.ref(hit);
    const range = this.timeRange();
    const { startNumber, averageDuration } = this.info;
    if (!range || sec < range.start || sec >= range.end || startNumber == null || !averageDuration) return null;
    const first = this.flat[0];
    const back = Math.ceil((first.t - x) / averageDuration);
    const number = Math.max(startNumber, first.number - back);
    const start = (first.t - (first.number - number) * averageDuration) / ts;
    return { number, url: fillTemplate(this.info.media, number), start, end: start + averageDuration / ts, predicted: false };
  }

  /** `count` segment SAU segment số `after`, lấy URL từ template dự đoán. */
  predictAfter(after: number, count = 1): SegmentRef[] {
    if (!this.canPredict) return [];
    const out: SegmentRef[] = [];
    for (let n = after + 1; n <= after + count; n++)
      out.push({ number: n, url: fillTemplate(this.info.predictedMedia!, n), start: NaN, end: NaN, predicted: true });
    return out;
  }

  last(): SegmentRef | null {
    return this.flat.length ? this.ref(this.flat[this.flat.length - 1]) : null;
  }
}

// ---------------------------------------------------------------- sidx

export interface SidxReference {
  /** 'media' = segment thật; 'index' = trỏ tới một sidx khác (sidx phân cấp). */
  kind: 'media' | 'index';
  startByte: number;
  endByte: number;
  start: number;
  end: number;
  startsWithSap: boolean;
}

const SIDX = 0x73696478; // 'sidx'

/**
 * Đọc hộp sidx. `bytes` có thể là view nằm giữa một ArrayBuffer lớn hơn:
 * DataView phải dùng đúng byteOffset/byteLength của view (bản gốc dùng `new DataView(u8.buffer)`).
 * `boxOffset` là vị trí của hộp sidx trong file, để tính byte tuyệt đối.
 */
export function parseSidx(bytes: Uint8Array, boxOffset: number): { timescale: number; references: SidxReference[] } {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let p = 0;
  const u32 = () => ((p += 4), v.getUint32(p - 4));
  const u64 = () => {
    const hi = u32();
    const lo = u32();
    const n = hi * 2 ** 32 + lo;
    if (!Number.isSafeInteger(n)) throw new Error('Giá trị 64-bit vượt Number.MAX_SAFE_INTEGER');
    return n;
  };
  let size = u32();
  if (u32() !== SIDX) throw new Error('Không phải hộp sidx');
  if (size === 1) size = u64(); // largesize
  const version = v.getUint8(p);
  p += 4; // version + flags
  p += 4; // reference_ID
  const timescale = u32();
  if (!timescale) throw new Error('timescale = 0');
  let time = version === 0 ? u32() : u64(); // earliest_presentation_time
  const firstOffset = version === 0 ? u32() : u64();
  p += 2; // reserved
  const count = v.getUint16(p);
  p += 2;
  let byte = boxOffset + size + firstOffset; // mốc: byte ngay sau hộp sidx
  const references: SidxReference[] = [];
  for (let i = 0; i < count; i++) {
    const a = u32();
    const duration = u32();
    const sap = u32();
    const refSize = a & 0x7fffffff;
    references.push({
      kind: a >>> 31 ? 'index' : 'media',
      startByte: byte,
      endByte: byte + refSize - 1,
      start: time / timescale,
      end: (time + duration) / timescale,
      startsWithSap: sap >>> 31 === 1,
    });
    time += duration;
    byte += refSize;
  }
  return { timescale, references };
}

/** Bản đọc giống bản gốc (bỏ qua byteOffset của view), chỉ để demo cho thấy lỗi. */
export function parseSidxIgnoringOffset(bytes: Uint8Array, boxOffset: number) {
  return parseSidx(new Uint8Array(bytes.buffer), boxOffset);
}

/** Tạo hộp sidx version 0 từ danh sách segment, dùng cho demo và test. */
export function buildSidx(timescale: number, segments: { size: number; duration: number }[], earliest = 0, firstOffset = 0): Uint8Array {
  const size = 32 + segments.length * 12;
  const v = new DataView(new ArrayBuffer(size));
  v.setUint32(0, size);
  v.setUint32(4, SIDX);
  v.setUint32(12, 1); // reference_ID
  v.setUint32(16, timescale);
  v.setUint32(20, earliest);
  v.setUint32(24, firstOffset);
  v.setUint16(30, segments.length);
  segments.forEach((s, i) => {
    const o = 32 + i * 12;
    v.setUint32(o, s.size & 0x7fffffff);
    v.setUint32(o + 4, s.duration);
    v.setUint32(o + 8, 0x90000000); // starts_with_SAP = 1, SAP_type = 1
  });
  return new Uint8Array(v.buffer);
}
