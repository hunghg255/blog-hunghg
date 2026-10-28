/**
 * Dựng một file WebM giả ngay trong trình duyệt cho demo: đúng cấu trúc EBML
 * (header, Segment, SeekHead, Info, Tracks, Cues, Cluster) nhưng dữ liệu khung hình là byte rác.
 */
import { EBML_ID, children } from './ebml';

const concat = (parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
};

/** VINT cho size; `len` cố định số byte (để kích thước không phụ thuộc giá trị). */
export function vintSize(n: number, len?: number): Uint8Array {
  let l = len ?? 1;
  while (len == null && n >= 2 ** (7 * l) - 1) l++;
  const out = new Uint8Array(l);
  let v = n;
  for (let i = l - 1; i >= 0; i--) {
    out[i] = v % 256;
    v = Math.floor(v / 256);
  }
  out[0] |= 0x80 >> (l - 1);
  return out;
}

const idBytes = (id: number) => {
  const out: number[] = [];
  for (let v = id; v > 0; v = Math.floor(v / 256)) out.unshift(v % 256);
  return Uint8Array.from(out);
};

export const el = (id: number, ...payload: Uint8Array[]) => {
  const body = concat(payload);
  return concat([idBytes(id), vintSize(body.length), body]);
};

export const uintEl = (id: number, v: number, width = 0) => {
  const out: number[] = [];
  for (let x = v; x > 0 || out.length < Math.max(1, width); x = Math.floor(x / 256)) out.unshift(x % 256);
  return el(id, Uint8Array.from(out));
};

const floatEl = (id: number, v: number) => {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setFloat64(0, v);
  return el(id, b);
};

const str = (s: string) => new TextEncoder().encode(s);

export interface WebmFixtureOptions {
  clusters: number;
  clusterSec: number;
  withDuration?: boolean;
  /** Đặt CueTrackPositions trước CueTime trong CuePoint (chuẩn không cấm). */
  swapCueOrder?: boolean;
  /** Segment với size "không biết" (toàn bit 1), như luồng live đang ghi. */
  unknownSegmentSize?: boolean;
}

export interface WebmFixture {
  bytes: Uint8Array;
  /** [start, end] bao gồm, giống thuộc tính Initialization@range / indexRange trong MPD. */
  initRange: [number, number];
  indexRange: [number, number];
  blocks: { name: string; start: number; end: number }[];
}

export function buildWebm(o: WebmFixtureOptions): WebmFixture {
  const scaleNs = 1_000_000; // 1 tick = 1 ms
  const header = el(EBML_ID.EBML, uintEl(0x4286, 1), uintEl(0x42f7, 1), uintEl(0x42f2, 4), uintEl(0x42f3, 8), el(0x4282, str('webm')), uintEl(0x4287, 4), uintEl(0x4285, 2));
  const info = el(EBML_ID.Info, uintEl(EBML_ID.TimecodeScale, scaleNs), ...(o.withDuration !== false ? [floatEl(EBML_ID.Duration, o.clusters * o.clusterSec * 1000)] : []), el(0x4d80, str('fixture')));
  const tracks = el(EBML_ID.Tracks, el(0xae, uintEl(0xd7, 1), uintEl(0x83, 1), el(0x86, str('V_VP9')), el(0xe0, uintEl(0xb0, 640), uintEl(0xba, 360))));

  // Kích thước giả của từng Cluster: keyframe to, các cluster sau nhỏ dần rồi tăng lại.
  const clusters = Array.from({ length: o.clusters }, (_, i) => {
    const payload = new Uint8Array(18_000 + ((i * 7919) % 11) * 2_400);
    for (let k = 0; k < payload.length; k++) payload[k] = (k * 31 + i) & 0xff;
    return el(EBML_ID.Cluster, uintEl(0xe7, Math.round(i * o.clusterSec * 1000)), el(0xa3, Uint8Array.of(0x81, 0, 0, 0x80), payload));
  });

  // Vị trí ghi bằng uint 4 byte để kích thước Cues/SeekHead không đổi khi điền số thật.
  const makeCues = (positions: number[]) =>
    el(
      EBML_ID.Cues,
      ...positions.map((p, i) => {
        const time = uintEl(EBML_ID.CueTime, Math.round(i * o.clusterSec * 1000), 4);
        const tp = el(EBML_ID.CueTrackPositions, uintEl(EBML_ID.CueTrack, 1), uintEl(EBML_ID.CueClusterPosition, p, 4));
        return el(EBML_ID.CuePoint, ...(o.swapCueOrder ? [tp, time] : [time, tp]));
      }),
    );
  const makeSeek = (infoPos: number, tracksPos: number, cuesPos: number) =>
    el(
      EBML_ID.SeekHead,
      ...[
        [EBML_ID.Info, infoPos],
        [EBML_ID.Tracks, tracksPos],
        [EBML_ID.Cues, cuesPos],
      ].map(([id, pos]) => el(EBML_ID.Seek, el(EBML_ID.SeekID, idBytes(id)), uintEl(EBML_ID.SeekPosition, pos, 4))),
    );

  const seekLen = makeSeek(0, 0, 0).length;
  const cuesLen = makeCues(clusters.map(() => 0)).length;
  const infoPos = seekLen;
  const tracksPos = infoPos + info.length;
  const cuesPos = tracksPos + tracks.length;
  const positions: number[] = [];
  let p = cuesPos + cuesLen;
  for (const c of clusters) {
    positions.push(p);
    p += c.length;
  }
  const body = [makeSeek(infoPos, tracksPos, cuesPos), info, tracks, makeCues(positions), ...clusters];
  const bodyLen = body.reduce((n, b) => n + b.length, 0);
  const segSize = o.unknownSegmentSize ? Uint8Array.of(0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff) : vintSize(bodyLen, 8);
  const segHeader = concat([idBytes(EBML_ID.Segment), segSize]);
  const bytes = concat([header, segHeader, ...body]);

  const base = header.length + segHeader.length;
  const blocks = [
    { name: 'EBML', start: 0, end: header.length - 1 },
    { name: 'Segment', start: header.length, end: base - 1 },
    { name: 'SeekHead', start: base, end: base + seekLen - 1 },
    { name: 'Info', start: base + infoPos, end: base + tracksPos - 1 },
    { name: 'Tracks', start: base + tracksPos, end: base + cuesPos - 1 },
    { name: 'Cues', start: base + cuesPos, end: base + cuesPos + cuesLen - 1 },
    ...positions.map((pos, i) => ({ name: `Cluster ${i}`, start: base + pos, end: base + pos + clusters[i].length - 1 })),
  ];
  return { bytes, initRange: [0, base + cuesPos - 1], indexRange: [base + cuesPos, base + cuesPos + cuesLen - 1], blocks };
}

const NAMES: Record<number, string> = {
  0x1a45dfa3: 'EBML', 0x4286: 'EBMLVersion', 0x42f7: 'EBMLReadVersion', 0x42f2: 'EBMLMaxIDLength', 0x42f3: 'EBMLMaxSizeLength',
  0x4282: 'DocType', 0x4287: 'DocTypeVersion', 0x4285: 'DocTypeReadVersion', 0x18538067: 'Segment', 0x114d9b74: 'SeekHead',
  0x4dbb: 'Seek', 0x53ab: 'SeekID', 0x53ac: 'SeekPosition', 0x1549a966: 'Info', 0x2ad7b1: 'TimecodeScale', 0x4489: 'Duration',
  0x4d80: 'MuxingApp', 0x1654ae6b: 'Tracks', 0xae: 'TrackEntry', 0xd7: 'TrackNumber', 0x83: 'TrackType', 0x86: 'CodecID',
  0xe0: 'Video', 0xb0: 'PixelWidth', 0xba: 'PixelHeight', 0x1c53bb6b: 'Cues', 0xbb: 'CuePoint', 0xb3: 'CueTime',
  0xb7: 'CueTrackPositions', 0xf7: 'CueTrack', 0xf1: 'CueClusterPosition', 0x1f43b675: 'Cluster', 0xe7: 'Timecode', 0xa3: 'SimpleBlock',
};
const MASTERS = new Set([0x1a45dfa3, 0x18538067, 0x114d9b74, 0x4dbb, 0x1549a966, 0x1654ae6b, 0xae, 0xe0, 0x1c53bb6b, 0xbb, 0xb7]);

export interface TreeRow {
  depth: number;
  name: string;
  id: string;
  start: number;
  headerLen: number;
  size: number | null;
}

/** Danh sách phẳng các phần tử (để vẽ cây), dừng ở `limit` dòng. */
export function ebmlTree(bytes: Uint8Array, limit = 60): TreeRow[] {
  const rows: TreeRow[] = [];
  const walk = (start: number, end: number, depth: number) => {
    for (const e of children(bytes, start, end)) {
      if (rows.length >= limit) return;
      rows.push({
        depth,
        name: NAMES[e.id] ?? '?',
        id: '0x' + e.id.toString(16).toUpperCase(),
        start: e.start,
        headerLen: e.dataStart - e.start,
        size: e.unknownSize ? null : e.dataEnd - e.dataStart,
      });
      if (MASTERS.has(e.id)) walk(e.dataStart, e.dataEnd, depth + 1);
    }
  };
  walk(0, bytes.length, 0);
  return rows;
}
