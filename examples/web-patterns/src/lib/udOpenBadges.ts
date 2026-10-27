/**
 * Đọc/nướng (bake) Open Badges trong ảnh PNG và SVG ngay trên trình duyệt.
 * Ý tưởng từ open-badges/upload-badge/image-parser-utils.ts của Udemy, viết lại:
 * - đọc chunk PNG bằng DataView, kiểm CRC, không cần polyfill Buffer của Node;
 * - tách iTXt đúng theo các byte NUL, hỗ trợ cả language tag lẫn nén deflate;
 * - SVG tìm theo namespace chứ không theo tiền tố "openbadges:";
 * - đoán loại file bằng magic number thay vì tin file.type.
 */

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
export const OB_KEYWORD = 'openbadges';
export const OB_NAMESPACE = 'https://purl.imsglobal.org/ob/v2p0';

export interface PngChunk {
  type: string;
  data: Uint8Array;
  crcOk: boolean;
}

// ---- CRC-32 (PNG dùng đa thức 0xEDB88320) ----

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ---- Đọc / ghi chunk ----

export function isPng(bytes: Uint8Array) {
  return PNG_SIGNATURE.every((b, i) => bytes[i] === b);
}

export function readPngChunks(buffer: ArrayBuffer): PngChunk[] {
  const bytes = new Uint8Array(buffer);
  if (!isPng(bytes)) throw new BadgeParseError('Không phải file PNG (sai 8 byte đầu)');
  const view = new DataView(buffer);
  const chunks: PngChunk[] = [];
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset);
    if (offset + 12 + length > bytes.length) throw new BadgeParseError('Chunk bị cắt cụt');
    const typeAndData = bytes.subarray(offset + 4, offset + 8 + length);
    const type = String.fromCharCode(...typeAndData.subarray(0, 4));
    const crc = view.getUint32(offset + 8 + length);
    chunks.push({ type, data: typeAndData.subarray(4), crcOk: crc32(typeAndData) === crc });
    offset += 12 + length;
    if (type === 'IEND') break;
  }
  return chunks;
}

function makeChunk(type: string, data: Uint8Array) {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

// ---- iTXt ----

export interface ITXt {
  keyword: string;
  compressed: boolean;
  languageTag: string;
  translatedKeyword: string;
  text: string;
}

const latin1 = new TextDecoder('latin1');
const utf8 = new TextDecoder();

/**
 * Cấu trúc iTXt: keyword \0 cờ-nén phương-thức-nén languageTag \0 translatedKeyword \0 text.
 * Tìm từng byte NUL thay vì giả định "keyword + 5 byte".
 */
export async function parseITXt(data: Uint8Array): Promise<ITXt> {
  const nul1 = data.indexOf(0);
  if (nul1 < 1 || nul1 > 79) throw new BadgeParseError('Keyword iTXt không hợp lệ');
  const compressed = data[nul1 + 1] === 1;
  const langStart = nul1 + 3;
  const nul2 = data.indexOf(0, langStart);
  const nul3 = data.indexOf(0, nul2 + 1);
  if (nul2 < 0 || nul3 < 0) throw new BadgeParseError('iTXt thiếu dấu phân cách');
  const raw = data.subarray(nul3 + 1);
  return {
    keyword: latin1.decode(data.subarray(0, nul1)),
    compressed,
    languageTag: latin1.decode(data.subarray(langStart, nul2)),
    translatedKeyword: utf8.decode(data.subarray(nul2 + 1, nul3)),
    text: utf8.decode(compressed ? await inflate(raw) : raw),
  };
}

export async function buildITXt(
  keyword: string,
  text: string,
  { languageTag = '', translatedKeyword = '', compress = false } = {},
): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const body = compress ? await deflate(enc.encode(text)) : enc.encode(text);
  const head = [...enc.encode(keyword), 0, compress ? 1 : 0, 0, ...enc.encode(languageTag), 0, ...enc.encode(translatedKeyword), 0];
  const out = new Uint8Array(head.length + body.length);
  out.set(head);
  out.set(body, head.length);
  return out;
}

async function pipeThrough(bytes: Uint8Array, stream: CompressionStream | DecompressionStream) {
  const res = new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream));
  return new Uint8Array(await res.arrayBuffer());
}
// PNG dùng zlib (RFC 1950), chính là 'deflate' của Compression Streams API.
const inflate = (b: Uint8Array) => pipeThrough(b, new DecompressionStream('deflate'));
const deflate = (b: Uint8Array) => pipeThrough(b, new CompressionStream('deflate'));

/** Chèn chunk iTXt openbadges trước IEND, thay chunk cũ nếu có (ảnh chỉ được chứa 1 assertion). */
export async function bakePng(png: ArrayBuffer, assertion: string, options?: Parameters<typeof buildITXt>[2]) {
  const chunks = readPngChunks(png);
  const parts: Uint8Array[] = [new Uint8Array(PNG_SIGNATURE)];
  for (const c of chunks) {
    if (c.type === 'iTXt' && latin1.decode(c.data.subarray(0, c.data.indexOf(0))) === OB_KEYWORD) continue;
    if (c.type === 'IEND') parts.push(makeChunk('iTXt', await buildITXt(OB_KEYWORD, assertion, options)));
    parts.push(makeChunk(c.type, c.data));
  }
  return new Blob(parts as BlobPart[], { type: 'image/png' });
}

// ---- Đọc assertion ----

export class BadgeParseError extends Error {
  name = 'BadgeParseError';
}

export interface BadgeAssertion {
  source: 'png-itxt' | 'svg';
  /** JSON assertion (có `id`), chữ ký JWS, hoặc chỉ là URL */
  kind: 'json' | 'jws' | 'url';
  /** URL để server tải và xác minh assertion */
  verifyUrl: string | null;
  raw: string;
}

/** Phân loại nội dung assertion theo Open Badges 2.0: JSON đã ký hay chưa ký, hoặc URL. */
export function classifyAssertion(raw: string): Pick<BadgeAssertion, 'kind' | 'verifyUrl'> {
  const s = raw.trim();
  if (s.startsWith('{')) {
    let json: { id?: string; verify?: { url?: string } };
    try {
      json = JSON.parse(s);
    } catch {
      throw new BadgeParseError('Assertion JSON hỏng');
    }
    return { kind: 'json', verifyUrl: json.verify?.url ?? json.id ?? null };
  }
  if (/^[\w-]+\.[\w-]+\.[\w-]+$/.test(s)) return { kind: 'jws', verifyUrl: null };
  if (/^https?:\/\//.test(s)) return { kind: 'url', verifyUrl: s };
  throw new BadgeParseError('Không nhận ra định dạng assertion');
}

export async function readBadgeFromPng(buffer: ArrayBuffer): Promise<BadgeAssertion> {
  for (const c of readPngChunks(buffer)) {
    if (c.type !== 'iTXt') continue;
    const itxt = await parseITXt(c.data);
    if (itxt.keyword !== OB_KEYWORD) continue; // so khớp CHÍNH XÁC, không phải startsWith
    return { source: 'png-itxt', raw: itxt.text, ...classifyAssertion(itxt.text) };
  }
  throw new BadgeParseError('PNG không có chunk iTXt "openbadges"');
}

export function readBadgeFromSvg(svgText: string): BadgeAssertion {
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  if (doc.getElementsByTagName('parsererror').length) throw new BadgeParseError('SVG không hợp lệ');
  // Theo namespace: tiền tố có thể là "openbadges:", "ob:"… miễn trỏ đúng URI.
  const node = doc.getElementsByTagNameNS(OB_NAMESPACE, 'assertion')[0];
  if (!node) throw new BadgeParseError('SVG không có <openbadges:assertion>');
  const inner = node.textContent?.trim() ?? '';
  const verify = node.getAttribute('verify');
  if (inner) return { source: 'svg', raw: inner, ...classifyAssertion(inner) };
  if (verify) return { source: 'svg', raw: verify, kind: 'url', verifyUrl: verify };
  throw new BadgeParseError('<assertion> không có verify cũng không có nội dung');
}

/** Đoán loại theo nội dung file (magic number), không dựa vào đuôi/MIME do trình duyệt đoán. */
export async function readBadge(file: Blob): Promise<BadgeAssertion> {
  const buffer = await file.arrayBuffer();
  const head = new Uint8Array(buffer, 0, Math.min(256, buffer.byteLength));
  if (isPng(head)) return readBadgeFromPng(buffer);
  const text = utf8.decode(head).trimStart();
  if (text.startsWith('<?xml') || text.startsWith('<svg')) return readBadgeFromSvg(utf8.decode(buffer));
  throw new BadgeParseError('Chỉ hỗ trợ PNG và SVG');
}
