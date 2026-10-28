/**
 * Đọc EBML (định dạng nhị phân của WebM/Matroska) đủ để dựng bảng segment cho DASH:
 * Info (TimecodeScale, Duration) trong phần init, rồi Cues: thời điểm ↔ vị trí Cluster.
 * Ý tưởng học từ oz-player/parsers/OzWebmSidxParser của Facebook, viết lại từ đầu.
 */

export const EBML_ID = {
  EBML: 0x1a45dfa3,
  Segment: 0x18538067,
  SeekHead: 0x114d9b74,
  Seek: 0x4dbb,
  SeekID: 0x53ab,
  SeekPosition: 0x53ac,
  Info: 0x1549a966,
  TimecodeScale: 0x2ad7b1,
  Duration: 0x4489,
  Tracks: 0x1654ae6b,
  Cues: 0x1c53bb6b,
  CuePoint: 0xbb,
  CueTime: 0xb3,
  CueTrackPositions: 0xb7,
  CueTrack: 0xf7,
  CueClusterPosition: 0xf1,
  Cluster: 0x1f43b675,
} as const;

export interface Vint {
  /** Số byte của VINT (1..8). */
  length: number;
  /** Giá trị: với ID giữ bit đánh dấu, với size thì bỏ. */
  value: number;
  /** Size toàn bit 1 nghĩa là "không biết kích thước" (live, đang ghi). */
  unknown: boolean;
}

/** Bit 1 đầu tiên của byte đầu cho biết VINT dài bao nhiêu byte: 1xxxxxxx → 1, 01xxxxxx → 2, … */
export function vintLength(first: number): number {
  if (first === 0) throw new RangeError('VINT dài hơn 8 byte');
  return Math.clz32(first) - 23;
}

export function readVint(bytes: Uint8Array, pos: number, keepMarker = false): Vint {
  if (pos >= bytes.length) throw new RangeError(`Hết dữ liệu ở byte ${pos}`);
  const length = vintLength(bytes[pos]);
  if (pos + length > bytes.length) throw new RangeError(`VINT ở byte ${pos} bị cắt cụt`);
  const mask = 0xff >> length; // các bit dữ liệu của byte đầu
  let value = keepMarker ? bytes[pos] : bytes[pos] & mask;
  let allOnes = (bytes[pos] & mask) === mask;
  for (let i = 1; i < length; i++) {
    value = value * 256 + bytes[pos + i];
    allOnes &&= bytes[pos + i] === 0xff;
  }
  if (!keepMarker && allOnes) return { length, value: -1, unknown: true };
  if (value > Number.MAX_SAFE_INTEGER) throw new RangeError(`VINT ở byte ${pos} vượt 53 bit`);
  return { length, value, unknown: false };
}

/** Số nguyên không dấu big-endian 0..8 byte. Vượt 2^53 − 1 thì ném lỗi thay vì trả số đã làm tròn. */
export function readUint(bytes: Uint8Array, start: number, end: number): number {
  if (end - start > 8) throw new RangeError('uint dài hơn 8 byte');
  let v = 0;
  for (let i = start; i < end; i++) v = v * 256 + bytes[i];
  if (v > Number.MAX_SAFE_INTEGER) throw new RangeError('uint vượt 53 bit, không biểu diễn chính xác bằng number');
  return v;
}

/** Float 0, 4 hoặc 8 byte (0 byte nghĩa là 0 theo chuẩn EBML). */
export function readFloat(bytes: Uint8Array, start: number, end: number): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset + start, end - start);
  if (end - start === 0) return 0;
  if (end - start === 4) return view.getFloat32(0);
  if (end - start === 8) return view.getFloat64(0);
  throw new RangeError('float phải dài 0, 4 hoặc 8 byte');
}

export interface EbmlElement {
  id: number;
  /** Vị trí byte của header, tính trong mảng đang đọc. */
  start: number;
  dataStart: number;
  dataEnd: number;
  unknownSize: boolean;
  /** Phần dữ liệu dài hơn phần mảng đang có (ví dụ chỉ tải phần đầu của Segment). */
  truncated: boolean;
}

/** Duyệt các phần tử con trong [start, end). Header bị cắt ở cuối thì dừng, không ném lỗi. */
export function* children(bytes: Uint8Array, start = 0, end = bytes.length): Generator<EbmlElement> {
  let pos = start;
  while (pos < end) {
    let id: Vint, size: Vint;
    try {
      id = readVint(bytes, pos, true);
      size = readVint(bytes, pos + id.length);
    } catch {
      return;
    }
    if (id.length > 4) throw new RangeError(`EBML ID ở byte ${pos} dài hơn 4 byte`);
    const dataStart = pos + id.length + size.length;
    const wanted = size.unknown ? end : dataStart + size.value;
    const dataEnd = Math.min(wanted, end);
    yield { id: id.value, start: pos, dataStart, dataEnd, unknownSize: size.unknown, truncated: wanted > end };
    pos = dataEnd;
  }
}

function find(bytes: Uint8Array, start: number, end: number, id: number) {
  for (const el of children(bytes, start, end)) if (el.id === id) return el;
  return null;
}

export interface WebmInit {
  /** Vị trí tuyệt đối (trong file) của byte dữ liệu đầu tiên của Segment; mọi vị trí trong Cues tính từ đây. */
  segmentDataOffset: number;
  /** Vị trí tuyệt đối ngay sau Segment, null nếu Segment không biết kích thước. */
  segmentDataEnd: number | null;
  /** Giây cho một đơn vị timecode (TimecodeScale mặc định 1 000 000 ns = 1 ms). */
  timecodeScaleSec: number;
  durationSec: number | null;
  /** Vị trí tuyệt đối của Cues lấy từ SeekHead, nếu có. */
  cuesOffset: number | null;
}

/**
 * Đọc phần init (EBML header + đầu Segment). `fileOffset` là vị trí của byte đầu tiên của `init` trong file.
 * Mọi vị trí tính theo chỉ số của chính Uint8Array, nên truyền một subarray cũng đúng.
 */
export function parseWebmInit(init: Uint8Array, fileOffset = 0): WebmInit | null {
  const top = children(init);
  const header = top.next().value;
  if (!header || header.id !== EBML_ID.EBML) return null;
  const segment = top.next().value;
  if (!segment || segment.id !== EBML_ID.Segment) return null;

  const base = fileOffset + segment.dataStart;
  let timecodeScaleSec = 1e-3;
  let durationTicks: number | null = null;
  let cuesOffset: number | null = null;
  for (const el of children(init, segment.dataStart, segment.dataEnd)) {
    if (el.id === EBML_ID.SeekHead) cuesOffset = readSeekHead(init, el, base);
    if (el.id !== EBML_ID.Info) continue;
    for (const f of children(init, el.dataStart, el.dataEnd)) {
      if (f.id === EBML_ID.TimecodeScale) timecodeScaleSec = readUint(init, f.dataStart, f.dataEnd) / 1e9;
      if (f.id === EBML_ID.Duration) durationTicks = readFloat(init, f.dataStart, f.dataEnd);
    }
    break;
  }
  return {
    segmentDataOffset: base,
    segmentDataEnd: segment.unknownSize ? null : base + segmentSize(init, segment),
    timecodeScaleSec,
    durationSec: durationTicks == null ? null : durationTicks * timecodeScaleSec,
    cuesOffset,
  };
}

/** Kích thước khai báo trong header (đúng cả khi phần dữ liệu đang có bị cắt). */
function segmentSize(bytes: Uint8Array, el: EbmlElement) {
  return readVint(bytes, el.start + vintLength(bytes[el.start])).value;
}

function readSeekHead(bytes: Uint8Array, head: EbmlElement, base: number): number | null {
  for (const seek of children(bytes, head.dataStart, head.dataEnd)) {
    if (seek.id !== EBML_ID.Seek) continue;
    const idEl = find(bytes, seek.dataStart, seek.dataEnd, EBML_ID.SeekID);
    const posEl = find(bytes, seek.dataStart, seek.dataEnd, EBML_ID.SeekPosition);
    if (idEl && posEl && readUint(bytes, idEl.dataStart, idEl.dataEnd) === EBML_ID.Cues) {
      return base + readUint(bytes, posEl.dataStart, posEl.dataEnd);
    }
  }
  return null;
}

export interface WebmSegment {
  index: number;
  startSec: number;
  /** null khi không biết thời lượng (live, thiếu Duration). */
  endSec: number | null;
  startByte: number;
  /** null nghĩa là "tới hết file": Range: bytes=start- */
  endByte: number | null;
}

/**
 * Đọc phần tử Cues và dựng bảng segment. Thứ tự CueTime/CueTrackPositions trong CuePoint không quan trọng;
 * `track` chọn CueTrackPositions của đúng track (mặc định lấy cái đầu tiên).
 */
export function parseWebmCues(cues: Uint8Array, init: WebmInit, track?: number): WebmSegment[] {
  const root = children(cues).next().value;
  if (!root || root.id !== EBML_ID.Cues) return [];
  const points: { time: number; pos: number }[] = [];
  for (const cp of children(cues, root.dataStart, root.dataEnd)) {
    if (cp.id !== EBML_ID.CuePoint) continue;
    let time: number | null = null;
    let pos: number | null = null;
    for (const f of children(cues, cp.dataStart, cp.dataEnd)) {
      if (f.id === EBML_ID.CueTime) time = readUint(cues, f.dataStart, f.dataEnd);
      if (f.id === EBML_ID.CueTrackPositions && pos == null) pos = readTrackPosition(cues, f, track);
    }
    if (time != null && pos != null) points.push({ time, pos });
  }
  points.sort((a, b) => a.time - b.time);

  const out: WebmSegment[] = [];
  points.forEach((p, i) => {
    if (i > 0 && p.pos === points[i - 1].pos) return; // hai cue cùng một Cluster
    out.push({ index: out.length, startSec: p.time * init.timecodeScaleSec, endSec: null, startByte: init.segmentDataOffset + p.pos, endByte: null });
  });
  for (let i = 0; i < out.length; i++) {
    const next = out[i + 1];
    out[i].endSec = next ? next.startSec : init.durationSec;
    out[i].endByte = next ? next.startByte - 1 : init.segmentDataEnd == null ? null : init.segmentDataEnd - 1;
  }
  return out;
}

function readTrackPosition(bytes: Uint8Array, el: EbmlElement, track?: number): number | null {
  let t: number | null = null;
  let pos: number | null = null;
  for (const f of children(bytes, el.dataStart, el.dataEnd)) {
    if (f.id === EBML_ID.CueTrack) t = readUint(bytes, f.dataStart, f.dataEnd);
    if (f.id === EBML_ID.CueClusterPosition) pos = readUint(bytes, f.dataStart, f.dataEnd);
  }
  return track == null || t === track ? pos : null;
}

/** Tìm segment chứa thời điểm t (giây) bằng tìm kiếm nhị phân. */
export function segmentAt(segments: WebmSegment[], t: number): WebmSegment | null {
  let lo = 0;
  let hi = segments.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const s = segments[mid];
    if (t < s.startSec) hi = mid - 1;
    else if (s.endSec != null && t >= s.endSec) lo = mid + 1;
    else return s;
  }
  return null;
}

/** Header HTTP Range cho một segment. */
export function rangeHeader(s: Pick<WebmSegment, 'startByte' | 'endByte'>): string {
  return `bytes=${s.startByte}-${s.endByte ?? ''}`;
}
