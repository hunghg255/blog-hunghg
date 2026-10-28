// Đọc metadata sticker WebP động: tổng thời lượng, số vòng lặp, độ dài frame đầu, emoji gắn kèm.
// Viết lại từ module dbjchhfjhj của WhatsApp Web bản 2020: đi theo chunk RIFF thay vì offset cố định.

export interface RiffChunk {
  fourcc: string;
  /** vị trí header chunk (fourcc) trong file */
  offset: number;
  /** kích thước payload, chưa tính byte đệm */
  size: number;
}

const u24 = (b: Uint8Array, at: number) => b[at] | (b[at + 1] << 8) | (b[at + 2] << 16);
const u32 = (b: Uint8Array, at: number) => (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0;
const fourcc = (b: Uint8Array, at: number) => String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3]);

/** Danh sách chunk trong [start, end); payload lẻ được đệm 1 byte theo chuẩn RIFF. */
export function walkChunks(b: Uint8Array, start = 12, end = b.byteLength): RiffChunk[] {
  const out: RiffChunk[] = [];
  for (let at = start; at + 8 <= end; ) {
    const size = u32(b, at + 4);
    if (at + 8 + size > end) break; // file cụt: dừng, không đọc tràn
    out.push({ fourcc: fourcc(b, at), offset: at, size });
    at += 8 + size + (size & 1);
  }
  return out;
}

export const MAX_DURATION = 5000;
export const MAX_LOOPS = 3;

/** Như bản gốc: lặp tối đa 3 vòng nhưng không quá 5 giây (ít nhất 1 vòng). */
export function totalAnimationDuration(singleLoop: number): number {
  if (singleLoop === 0) return 0;
  return Math.max(Math.min(Math.floor(MAX_DURATION / singleLoop), MAX_LOOPS), 1) * singleLoop;
}

export interface StickerMeta {
  extended: boolean;
  animated: boolean;
  hasIccp: boolean;
  frames: { duration: number; width: number; height: number }[];
  singleLoopDuration: number;
  animationDuration: number;
  /** byte kết thúc frame đầu: đủ để hiện frame tĩnh trước khi tải hết */
  firstFrameLength?: number;
  emojis: string[];
}

export function parseWebpSticker(b: Uint8Array): StickerMeta {
  if (fourcc(b, 0) !== 'RIFF' || fourcc(b, 8) !== 'WEBP') throw new Error('không phải WebP');
  const chunks = walkChunks(b, 12, Math.min(b.byteLength, 8 + u32(b, 4)));
  const vp8x = chunks[0]?.fourcc === 'VP8X' ? chunks[0] : undefined;
  const flags = vp8x ? b[vp8x.offset + 8] : 0;
  const frames: StickerMeta['frames'] = [];
  let firstFrameLength: number | undefined;
  for (const c of chunks) {
    if (c.fourcc !== 'ANMF') continue;
    const p = c.offset + 8;
    frames.push({ width: u24(b, p + 6) + 1, height: u24(b, p + 9) + 1, duration: u24(b, p + 12) });
    firstFrameLength ??= c.offset + 8 + c.size + (c.size & 1);
  }
  const singleLoopDuration = frames.reduce((n, f) => n + f.duration, 0);
  return {
    extended: !!vp8x,
    animated: (flags & 0x02) !== 0,
    hasIccp: chunks.some((c) => c.fourcc === 'ICCP'),
    frames,
    singleLoopDuration,
    animationDuration: totalAnimationDuration(singleLoopDuration),
    firstFrameLength,
    emojis: stickerEmojis(b, chunks),
  };
}

/** JSON {"emojis": [...]} nằm trong chunk EXIF hoặc "XMP " (4 ký tự, có dấu cách). Chỉ đọc trong chunk đó. */
export function stickerEmojis(b: Uint8Array, chunks = walkChunks(b)): string[] {
  const dec = new TextDecoder();
  for (const c of chunks) {
    if (c.fourcc !== 'EXIF' && c.fourcc !== 'XMP ') continue;
    const text = dec.decode(b.subarray(c.offset + 8, c.offset + 8 + c.size));
    const open = text.indexOf('{');
    const close = text.lastIndexOf('}');
    if (open < 0 || close < open) continue;
    try {
      const json = JSON.parse(text.slice(open, close + 1));
      if (Array.isArray(json.emojis)) return json.emojis.filter((e: unknown) => typeof e === 'string');
    } catch {
      // chunk không chứa JSON hợp lệ: thử chunk kế
    }
  }
  return [];
}

// ---------------------------------------------------------------------------
// Dựng file WebP từ các chunk: dùng trong demo/test để tạo sticker có hoặc không có ICCP, XMP.

export function chunk(id: string, payload: Uint8Array): Uint8Array {
  const pad = payload.byteLength & 1;
  const out = new Uint8Array(8 + payload.byteLength + pad);
  for (let i = 0; i < 4; i++) out[i] = id.charCodeAt(i);
  new DataView(out.buffer).setUint32(4, payload.byteLength, true);
  out.set(payload, 8);
  return out;
}

const le24 = (n: number) => [n & 255, (n >> 8) & 255, (n >> 16) & 255];

export interface BuildFrame {
  width: number;
  height: number;
  duration: number;
  /** các chunk ảnh của frame (VP8/VP8L, có thể kèm ALPH) */
  image: Uint8Array;
}

export function buildAnimatedWebp(
  frames: BuildFrame[],
  { iccp, exif, xmp, loops = 0 }: { iccp?: Uint8Array; exif?: Uint8Array; xmp?: Uint8Array; loops?: number } = {},
): Uint8Array<ArrayBuffer> {
  const w = Math.max(...frames.map((f) => f.width));
  const h = Math.max(...frames.map((f) => f.height));
  const flags = (iccp ? 0x20 : 0) | 0x10 | (exif ? 0x08 : 0) | (xmp ? 0x04 : 0) | 0x02;
  const parts = [chunk('VP8X', new Uint8Array([flags, 0, 0, 0, ...le24(w - 1), ...le24(h - 1)]))];
  if (iccp) parts.push(chunk('ICCP', iccp)); // chuẩn đặt ICCP ngay sau VP8X, trước ANIM
  parts.push(chunk('ANIM', new Uint8Array([0, 0, 0, 0, loops & 255, loops >> 8])));
  for (const f of frames) {
    const head = [0, 0, 0, 0, 0, 0, ...le24(f.width - 1), ...le24(f.height - 1), ...le24(f.duration), 0];
    parts.push(chunk('ANMF', new Uint8Array([...head, ...f.image])));
  }
  if (exif) parts.push(chunk('EXIF', exif));
  if (xmp) parts.push(chunk('XMP ', xmp));
  const body = parts.reduce((n, p) => n + p.byteLength, 0);
  const out = new Uint8Array(12 + body);
  out.set([82, 73, 70, 70], 0);
  new DataView(out.buffer).setUint32(4, 4 + body, true);
  out.set([87, 69, 66, 80], 8);
  let at = 12;
  for (const p of parts) {
    out.set(p, at);
    at += p.byteLength;
  }
  return out;
}

/** Payload EXIF kiểu sticker WhatsApp: vài byte TIFF, NUL rồi JSON. */
export function stickerJsonPayload(meta: Record<string, unknown>): Uint8Array {
  return new Uint8Array([0x49, 0x49, 0x2a, 0, 8, 0, 0, 0, 0, ...new TextEncoder().encode(JSON.stringify(meta))]);
}

// ---------------------------------------------------------------------------
// Bản port logic gốc (dbjchhfjhj), chỉ để so sánh trong demo và test.

export function parseLikeOriginal(t: Uint8Array) {
  const eq = (at: number, s: string) => fourcc(t, at) === s;
  const le = (a: Uint8Array) => a.reduce((n, x, i) => n + (x << (8 * i)), 0);
  const empty = { animationDuration: 0, singleLoopDuration: 0, emojis: [] as string[], firstFrameLength: undefined as number | undefined };
  if (!eq(12, 'VP8X')) return empty;
  let single = 0;
  let s = 44; // giả định ANIM ngay sau VP8X: 12 + 18 + 14
  let first: number | undefined;
  while (eq(s, 'ANMF')) {
    single += le(t.slice(s + 20, s + 23));
    s += 8 + le(t.slice(s + 4, s + 8));
    first ??= s;
  }
  // g(): so fourcc với "XMP" (3 ký tự) nên chunk "XMP " không bao giờ khớp
  const dec = new TextDecoder();
  let emojis: string[] = [];
  for (let i = 12; i < t.byteLength; ) {
    const id = dec.decode(t.slice(i, i + 4));
    let size = le(t.slice(i + 4, i + 8));
    if (size % 2) size += 1;
    if (id === 'EXIF' || id === 'XMP') {
      const l = dec.decode(t.slice(i));
      let open: number | undefined;
      let close: number | undefined;
      for (let h = l.length; h > 0; --h) {
        if (close == null && l[h] === '}') close = h;
        else if (close != null && l[h] === '\0') {
          open = h + 1;
          break;
        }
      }
      try {
        emojis = open != null && close != null ? JSON.parse(l.substring(open, close + 1)).emojis : [];
      } catch {
        emojis = [];
      }
      break;
    }
    i += 8 + size;
  }
  return { animationDuration: totalAnimationDuration(single), singleLoopDuration: single, emojis, firstFrameLength: first };
}
