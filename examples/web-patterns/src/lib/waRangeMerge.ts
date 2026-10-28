// Ghép các khoảng byte tải về không theo thứ tự (video streaming) và kiểm HMAC theo khối 64 KB.
// Viết lại từ edgfejedb (bộ đệm video streaming) và cggdahefjh (sidecar streaming)
// của WhatsApp Web bản 2020.

import { concat, hmac10, MAC_LENGTH, timingSafeEqual, type Bytes } from './waProgressiveJpeg';

export const STREAM_BLOCK = 64 * 1024;
const IV_LENGTH = 16;

/** Tập khoảng [start, end] (gồm cả end), luôn sắp xếp, không chồng lấn, không kề nhau. */
export class RangeSet {
  readonly ranges: [number, number][] = [];

  /** Thêm khoảng, gộp với các khoảng chồng lấn hoặc kề; trả về số byte mới được phủ. */
  add(start: number, end: number): number {
    if (end < start) return 0;
    const r = this.ranges;
    let i = 0;
    while (i < r.length && r[i][1] + 1 < start) i++;
    let s = start;
    let e = end;
    let already = 0;
    let j = i;
    for (; j < r.length && r[j][0] <= end + 1; j++) {
      already += Math.max(0, Math.min(end, r[j][1]) - Math.max(start, r[j][0]) + 1);
      s = Math.min(s, r[j][0]);
      e = Math.max(e, r[j][1]);
    }
    r.splice(i, j - i, [s, e]);
    return end - start + 1 - already;
  }

  /** Bỏ một khoảng (vd khối sai MAC) để xin tải lại. */
  remove(start: number, end: number): void {
    const out: [number, number][] = [];
    for (const [s, e] of this.ranges) {
      if (e < start || s > end) out.push([s, e]);
      else {
        if (s < start) out.push([s, start - 1]);
        if (e > end) out.push([end + 1, e]);
      }
    }
    this.ranges.splice(0, this.ranges.length, ...out);
  }

  covers(start: number, end: number): boolean {
    return this.ranges.some(([s, e]) => s <= start && end <= e);
  }

  get covered(): number {
    return this.ranges.reduce((n, [s, e]) => n + e - s + 1, 0);
  }

  /** Các lỗ còn thiếu trong [0, size - 1]: đúng những Range cần xin tiếp. */
  missing(size: number): [number, number][] {
    const out: [number, number][] = [];
    let at = 0;
    for (const [s, e] of this.ranges) {
      if (s > at) out.push([at, s - 1]);
      at = e + 1;
    }
    if (at < size) out.push([at, size - 1]);
    return out;
  }
}

/** Bộ đệm cấp phát đúng một lần: mỗi đoạn tải về chép thẳng vào vị trí của nó. */
export class RangeBuffer {
  readonly bytes: Bytes;
  readonly ranges = new RangeSet();
  /** tổng byte nhận qua mạng, kể cả phần trùng */
  received = 0;

  constructor(readonly size: number) {
    if (!(size > 0)) throw new Error(`kích thước không hợp lệ: ${size}`);
    this.bytes = new Uint8Array(size);
  }

  write(start: number, data: Uint8Array): number {
    if (start < 0 || start + data.byteLength > this.size) throw new Error('đoạn nằm ngoài file');
    this.bytes.set(data, start);
    this.received += data.byteLength;
    return this.ranges.add(start, start + data.byteLength - 1);
  }

  get complete(): boolean {
    const r = this.ranges.ranges;
    return r.length === 1 && r[0][0] === 0 && r[0][1] === this.size - 1;
  }
}

/**
 * Bên gửi: chuỗi ký là iv ‖ ciphertext ‖ mac. Khối k phủ 16 byte trước nó (iv của khối) + 64 KB,
 * nên khi tải một Range giữa file vẫn kiểm (và giải mã) được mà không cần phần trước.
 */
export async function buildStreamingSidecar(iv: Bytes, file: Bytes, macKey: CryptoKey): Promise<Bytes> {
  const signed = concat(iv, file);
  const count = Math.ceil(file.byteLength / STREAM_BLOCK);
  const macs: Bytes[] = [];
  for (let k = 0; k < count; k++)
    macs.push(await hmac10(macKey, signed.subarray(k * STREAM_BLOCK, k * STREAM_BLOCK + IV_LENGTH + STREAM_BLOCK)));
  return concat(...macs);
}

/** Khoảng byte của file (ciphertext ‖ mac) cần có để kiểm khối k. */
export function blockSpan(k: number, size: number): [number, number] {
  return [Math.max(0, k * STREAM_BLOCK - IV_LENGTH), Math.min(size, (k + 1) * STREAM_BLOCK) - 1];
}

/** Các khối đã đủ byte để kiểm. */
export function readyBlocks(buf: RangeBuffer): number[] {
  const out: number[] = [];
  const count = Math.ceil(buf.size / STREAM_BLOCK);
  for (let k = 0; k < count; k++) if (buf.ranges.covers(...blockSpan(k, buf.size))) out.push(k);
  return out;
}

export async function verifyBlock(buf: RangeBuffer, k: number, iv: Bytes, sidecar: Bytes, macKey: CryptoKey) {
  const [s, e] = blockSpan(k, buf.size);
  if (!buf.ranges.covers(s, e)) throw new Error(`khối ${k} chưa tải đủ`);
  const head = k === 0 ? iv : new Uint8Array(0);
  const mac = await hmac10(macKey, concat(head, buf.bytes.subarray(s, e + 1)));
  return timingSafeEqual(mac, sidecar.subarray(k * MAC_LENGTH, (k + 1) * MAC_LENGTH));
}
