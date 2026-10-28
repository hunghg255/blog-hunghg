// Giải mã JPEG progressive theo từng scan, mỗi đoạn kiểm HMAC riêng.
// Viết lại từ module ImageStreamer (dhibedeibc) và tiện ích crypto (dhgjbgdbhg)
// của WhatsApp Web bản 2020. Khoá trong demo do trình duyệt tự sinh.

/** Byte nằm trên ArrayBuffer thường (WebCrypto không nhận SharedArrayBuffer). */
export type Bytes = Uint8Array<ArrayBuffer>;

export const MAC_LENGTH = 10;
const BLOCK = 16;
/** Khối "đệm giả" WhatsApp mã hoá thêm để giải mã được ciphertext dở dang. */
const FAKE_TAIL = new Uint8Array([2, 2]);
export const EOI = new Uint8Array([0xff, 0xd9]);

export interface MediaKeys {
  iv: Bytes;
  encKey: CryptoKey;
  macKey: CryptoKey;
}

/** HKDF-SHA256(mediaKey, info) → 112 byte: iv | encKey | macKey | refKey. */
export async function deriveMediaKeys(mediaKey: Bytes, info = 'WhatsApp Image Keys'): Promise<MediaKeys> {
  const base = await crypto.subtle.importKey('raw', mediaKey, 'HKDF', false, ['deriveBits']);
  const bits = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: new TextEncoder().encode(info) },
      base,
      112 * 8,
    ),
  );
  const encKey = await crypto.subtle.importKey('raw', bits.slice(16, 48), 'AES-CBC', false, ['encrypt', 'decrypt']);
  const macKey = await crypto.subtle.importKey('raw', bits.slice(48, 80), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  return { iv: bits.slice(0, 16), encKey, macKey };
}

export function concat(...parts: Uint8Array[]): Bytes {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.byteLength;
  }
  return out;
}

/** So sánh không thoát sớm: thời gian chạy không phụ thuộc vị trí byte sai đầu tiên. */
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  let diff = 0;
  for (let i = 0; i < a.byteLength; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function hmac10(key: CryptoKey, data: Bytes): Promise<Bytes> {
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, data)).slice(0, MAC_LENGTH);
}

/** Bên gửi: AES-CBC rồi gắn 10 byte HMAC(iv ‖ ciphertext) vào cuối. */
export async function encryptMedia(plain: Bytes, keys: MediaKeys): Promise<Bytes> {
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-CBC', iv: keys.iv }, keys.encKey, plain));
  return concat(ct, await hmac10(keys.macKey, concat(keys.iv, ct)));
}

/** Bên nhận, kiểu tải hết rồi mới giải mã (decryptE2EMedia). */
export async function decryptMedia(enc: Bytes, keys: MediaKeys): Promise<Bytes> {
  if (enc.byteLength < MAC_LENGTH + BLOCK) throw new Error('ciphertext quá ngắn');
  const ct = enc.subarray(0, enc.byteLength - MAC_LENGTH);
  const mac = enc.subarray(enc.byteLength - MAC_LENGTH);
  if (!timingSafeEqual(await hmac10(keys.macKey, concat(keys.iv, ct)), mac)) throw new Error('HMAC không khớp');
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-CBC', iv: keys.iv }, keys.encKey, ct));
}

const alignUp = (n: number) => Math.ceil(n / BLOCK) * BLOCK;

/**
 * Độ dài plaintext từng scan → độ dài đoạn ciphertext, mỗi đoạn kết thúc ở bội 16.
 * Đoạn cuối kéo tới hết file mã hoá (gồm padding PKCS#7 và 10 byte MAC).
 * Scan quá ngắn không vượt qua mốc đã căn thì gộp vào đoạn sau.
 */
export function alignChunkLengths(scanLengths: number[], encTotal: number): number[] {
  const out: number[] = [];
  let plainEnd = 0;
  let aligned = 0;
  for (let i = 0; i < scanLengths.length - 1; i++) {
    plainEnd += scanLengths[i];
    if (plainEnd <= aligned) continue;
    const next = alignUp(plainEnd);
    out.push(next - aligned);
    aligned = next;
  }
  // Nếu mốc căn trước đã chạm cuối ciphertext thì đoạn cuối sẽ rỗng: gộp vào đoạn trước.
  if (aligned >= encTotal - MAC_LENGTH && out.length) aligned -= out.pop()!;
  out.push(encTotal - aligned);
  return out;
}

/** Bên gửi: 10 byte HMAC(iv của đoạn ‖ đoạn) cho mỗi đoạn. iv của đoạn sau = 16 byte cuối đoạn trước. */
export async function buildScansSidecar(enc: Bytes, chunkLengths: number[], keys: MediaKeys) {
  const macs: Uint8Array[] = [];
  let iv = keys.iv;
  let at = 0;
  for (const len of chunkLengths) {
    const chunk = enc.subarray(at, at + len);
    macs.push(await hmac10(keys.macKey, concat(iv, chunk)));
    iv = chunk.slice(-BLOCK);
    at += len;
  }
  return concat(...macs);
}

/**
 * Tách JPEG progressive thành các scan: độ dài thứ i kết thúc ngay sau dữ liệu entropy
 * của scan i (đoạn đầu gồm cả header). Cộng dồn k phần đầu + FFD9 là một JPEG hợp lệ k scan.
 */
export function splitJpegScans(jpeg: Uint8Array): number[] {
  if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8) throw new Error('không phải JPEG');
  const ends: number[] = [];
  let i = 2;
  while (i + 4 <= jpeg.length) {
    if (jpeg[i] !== 0xff) throw new Error(`mất đồng bộ marker ở ${i}`);
    const marker = jpeg[i + 1];
    if (marker === 0xd9) break;
    const len = (jpeg[i + 2] << 8) | jpeg[i + 3];
    i += 2 + len;
    if (marker !== 0xda) continue;
    // Dữ liệu entropy: chạy tới 0xFF đi sau bởi byte khác 00 và khác RST0..7.
    while (i + 1 < jpeg.length && !(jpeg[i] === 0xff && jpeg[i + 1] !== 0 && (jpeg[i + 1] < 0xd0 || jpeg[i + 1] > 0xd7)))
      i++;
    ends.push(i);
  }
  ends[ends.length - 1] = jpeg.length;
  return ends.map((end, k) => end - (k ? ends[k - 1] : 0));
}

export interface ChunkResult {
  index: number;
  /** số scan hiển thị được sau đoạn này */
  scans: number;
  image: Bytes;
}

/**
 * Bên nhận: nhận dần các byte đã tải, xong đoạn nào thì kiểm sidecar, giải mã đoạn đó
 * (không giải mã lại phần trước) và dựng ảnh từ các scan đã đủ.
 */
export class ProgressiveDecryptor {
  private chunkLengths: number[];
  private chunkEnds: number[];
  private plain: Uint8Array[] = [];
  private iv: Bytes;
  private received = new Uint8Array(0);
  private failed = false;

  constructor(
    private keys: MediaKeys,
    private scanLengths: number[],
    private sidecar: Bytes,
    encTotal: number,
  ) {
    this.chunkLengths = alignChunkLengths(scanLengths, encTotal);
    let sum = 0;
    this.chunkEnds = this.chunkLengths.map((n) => (sum += n));
    this.iv = keys.iv;
    if (sidecar.byteLength !== this.chunkLengths.length * MAC_LENGTH) throw new Error('sidecar sai độ dài');
  }

  get chunkCount() {
    return this.chunkLengths.length;
  }

  get done() {
    return this.plain.length === this.chunkLengths.length;
  }

  /** Cộng thêm byte vừa tải; trả về các đoạn mới giải mã được (rỗng nếu chưa đủ đoạn nào). */
  async push(bytes: Bytes): Promise<ChunkResult[]> {
    if (this.failed) throw new Error('đã dừng vì đoạn trước sai MAC');
    this.received = concat(this.received, bytes);
    const out: ChunkResult[] = [];
    while (!this.done && this.received.byteLength >= this.chunkEnds[this.plain.length]) {
      const index = this.plain.length;
      const start = index ? this.chunkEnds[index - 1] : 0;
      const chunk = this.received.subarray(start, this.chunkEnds[index]);
      const expected = this.sidecar.subarray(index * MAC_LENGTH, (index + 1) * MAC_LENGTH);
      if (!timingSafeEqual(await hmac10(this.keys.macKey, concat(this.iv, chunk)), expected)) {
        this.failed = true;
        throw new Error(`đoạn ${index} không khớp sidecar`);
      }
      this.plain.push(await this.decryptChunk(chunk, this.iv));
      this.iv = chunk.slice(-BLOCK);
      out.push(this.render(index));
    }
    return out;
  }

  private async decryptChunk(chunk: Bytes, iv: Bytes): Promise<Bytes> {
    const aes = { name: 'AES-CBC', iv };
    if (chunk.byteLength % BLOCK !== 0) {
      // Đoạn cuối: bỏ 10 byte MAC, phần còn lại có padding PKCS#7 thật.
      return new Uint8Array(await crypto.subtle.decrypt(aes, this.keys.encKey, chunk.subarray(0, -MAC_LENGTH)));
    }
    // Đoạn giữa không có padding nên WebCrypto sẽ từ chối. Mã hoá [2,2] với iv = khối cuối của đoạn:
    // khối thu được giải mã ra [2,2] + padding hợp lệ, nối vào là giải mã được, rồi cắt [2,2] đi.
    const tail = new Uint8Array(
      await crypto.subtle.encrypt({ name: 'AES-CBC', iv: chunk.slice(-BLOCK) }, this.keys.encKey, FAKE_TAIL),
    );
    const plain = new Uint8Array(await crypto.subtle.decrypt(aes, this.keys.encKey, concat(chunk, tail)));
    return plain.subarray(0, plain.byteLength - FAKE_TAIL.byteLength);
  }

  private render(index: number): ChunkResult {
    const all = concat(...this.plain);
    // Số scan đã nằm trọn trong phần plaintext đang có.
    let scans = 0;
    let need = 0;
    while (scans < this.scanLengths.length && need + this.scanLengths[scans] <= all.byteLength) need += this.scanLengths[scans++];
    const body = all.subarray(0, need);
    const hasEoi = body[need - 2] === 0xff && body[need - 1] === 0xd9;
    return { index, scans, image: hasEoi ? body : concat(body, EOI) };
  }
}
