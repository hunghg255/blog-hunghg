/**
 * Thumbnail "stripped" kiểu Telegram: ảnh JPEG nhỏ (≤ 40px) mà server chỉ gửi phần thân,
 * vì phần header (bảng lượng tử, bảng Huffman…) giống hệt nhau ở mọi ảnh.
 *
 * Định dạng stripped: [1 (phiên bản), chiều cao, chiều rộng, ...thân JPEG không có FFD9]
 * Client ghép lại: HEADER cố định (ghi kích thước vào SOF0) + thân + FFD9 → JPEG hợp lệ.
 *
 * Để mẹo này chạy được, bên mã hoá PHẢI dùng đúng bảng trong header cố định. Encoder trình duyệt
 * (canvas.toBlob) tự tối ưu bảng Huffman cho từng ảnh nên không dùng được; file này có một encoder
 * JPEG baseline nhỏ đọc bảng thẳng từ header.
 */

// Header 623 byte của định dạng stripped (hằng số của giao thức, client Telegram nào cũng có).
// Gồm: SOI, APP0/JFIF, 2 bảng DQT, SOF0 (3 kênh, 4:2:0), 4 bảng DHT chuẩn (Annex K), SOS.
// prettier-ignore
const STRIPPED_HEADER_HEX =
  'ffd8ffe000104a46494600010100000100010000ffdb004300281c1e231e19282321232d2b28303c64413c37373c7b585d4964918099968f808c8aa0b4e6c3a0aadaad8a8cc8ffcbdaeef5ffffff9bc1fffffffaffe6fdfff8ffdb0043012b2d2d3c353c76414176f8a58ca5f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8ffc00011080000000003012200021101031101ffc4001f0000010501010101010100000000000000000102030405060708090a0bffc400b5100002010303020403050504040000017d01020300041105122131410613516107227114328191a1082342b1c11552d1f02433627282090a161718191a25262728292a3435363738393a434445464748494a535455565758595a636465666768696a737475767778797a838485868788898a92939495969798999aa2a3a4a5a6a7a8a9aab2b3b4b5b6b7b8b9bac2c3c4c5c6c7c8c9cad2d3d4d5d6d7d8d9dae1e2e3e4e5e6e7e8e9eaf1f2f3f4f5f6f7f8f9faffc4001f0100030101010101010101010000000000000102030405060708090a0bffc400b51100020102040403040705040400010277000102031104052131061241510761711322328108144291a1b1c109233352f0156272d10a162434e125f11718191a262728292a35363738393a434445464748494a535455565758595a636465666768696a737475767778797a82838485868788898a92939495969798999aa2a3a4a5a6a7a8a9aab2b3b4b5b6b7b8b9bac2c3c4c5c6c7c8c9cad2d3d4d5d6d7d8d9dae2e3e4e5e6e7e8e9eaf2f3f4f5f6f7f8f9faffda000c03010002110311003f00';

export const STRIPPED_HEADER = hexToBytes(STRIPPED_HEADER_HEX);
const JPEG_FOOTER = new Uint8Array([0xff, 0xd9]);

// Vị trí trong header: SOF0 bắt đầu ở byte 158 (FF C0), sau đó là độ dài (2), độ chính xác (1),
// chiều cao (2 byte, big-endian) ở 163–164 và chiều rộng ở 165–166.
// Telegram chỉ ghi byte thấp (164, 166) nên kích thước tối đa là 255px.
export const HEIGHT_OFFSET = 164;
export const WIDTH_OFFSET = 166;
export const MAX_STRIPPED_SIZE = 255;

// ---- Phía client: ghép lại ----

/** stripped → JPEG đầy đủ. Không đúng định dạng thì trả nguyên bytes (như Telegram). */
export function strippedToJpeg(stripped: Uint8Array): Uint8Array {
  if (stripped.length < 3 || stripped[0] !== 1) return stripped;
  const header = STRIPPED_HEADER.slice();
  header[HEIGHT_OFFSET] = stripped[1];
  header[WIDTH_OFFSET] = stripped[2];
  const out = new Uint8Array(header.length + stripped.length - 3 + JPEG_FOOTER.length);
  out.set(header, 0);
  out.set(stripped.subarray(3), header.length);
  out.set(JPEG_FOOTER, out.length - JPEG_FOOTER.length);
  return out;
}

export function bytesToDataUri(bytes: Uint8Array, mime = 'image/jpeg') {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return `data:${mime};base64,${btoa(binary)}`;
}

/**
 * Làm mờ ảnh nhỏ lên canvas. Vẽ ảnh rộng ra mỗi bên 2×radius rồi mới blur
 * (giống useCanvasBlur của Telegram): nếu không, mép ảnh bị "ăn" màu trong suốt và tối đi.
 * Trả false nếu trình duyệt không hỗ trợ ctx.filter: khi đó cho phần tử CSS `filter: blur()`
 * (Telegram thì chạy box blur bằng JS, thư viện "Superfast Blur").
 */
export function drawBlurred(canvas: HTMLCanvasElement, img: CanvasImageSource, width: number, height: number, radius = 2) {
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false })!;
  const supported = 'filter' in ctx;
  if (supported) ctx.filter = `blur(${radius}px)`;
  ctx.drawImage(img, -radius * 2, -radius * 2, width + radius * 4, height + radius * 4);
  if (supported) ctx.filter = 'none';
  return supported;
}

// ---- Phía server (hoặc demo): mã hoá bằng đúng bảng trong header ----

interface HuffmanTable {
  codes: Uint16Array; // mã theo giá trị symbol
  sizes: Uint8Array; // độ dài mã (bit)
}

interface Tables {
  quant: Uint8Array[]; // theo thứ tự zigzag, như lưu trong file
  dc: HuffmanTable[];
  ac: HuffmanTable[];
}

let cachedTables: Tables | undefined;

/** Đọc DQT và DHT từ header: encoder không tự chọn bảng nào cả. */
function readTables(): Tables {
  if (cachedTables) return cachedTables;
  const quant: Uint8Array[] = [];
  const dc: HuffmanTable[] = [];
  const ac: HuffmanTable[] = [];
  const h = STRIPPED_HEADER;
  let i = 2;
  while (i < h.length) {
    const marker = h[i + 1];
    const length = (h[i + 2] << 8) | h[i + 3];
    const segment = h.subarray(i + 4, i + 2 + length);
    if (marker === 0xdb) {
      for (let p = 0; p < segment.length; p += 65) quant[segment[p] & 15] = segment.slice(p + 1, p + 65);
    } else if (marker === 0xc4) {
      let p = 0;
      while (p < segment.length) {
        const tableClass = segment[p] >> 4;
        const id = segment[p] & 15;
        const counts = segment.subarray(p + 1, p + 17);
        const total = counts.reduce((a, b) => a + b, 0);
        const symbols = segment.subarray(p + 17, p + 17 + total);
        (tableClass === 0 ? dc : ac)[id] = buildHuffman(counts, symbols);
        p += 17 + total;
      }
    }
    if (marker === 0xda) break;
    i += 2 + length;
  }
  cachedTables = { quant, dc, ac };
  return cachedTables;
}

/** Sinh mã Huffman chính tắc (canonical) từ số lượng mã mỗi độ dài, như JPEG quy định. */
function buildHuffman(counts: Uint8Array, symbols: Uint8Array): HuffmanTable {
  const codes = new Uint16Array(256);
  const sizes = new Uint8Array(256);
  let code = 0;
  let k = 0;
  for (let length = 1; length <= 16; length++) {
    for (let n = 0; n < counts[length - 1]; n++) {
      codes[symbols[k]] = code;
      sizes[symbols[k]] = length;
      code++;
      k++;
    }
    code <<= 1;
  }
  return { codes, sizes };
}

// prettier-ignore
const ZIGZAG = [
  0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21,
  28, 35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61,
  54, 47, 55, 62, 63,
];

const COS = Array.from({ length: 64 }, (_, i) => Math.cos(((2 * (i >> 3) + 1) * (i & 7) * Math.PI) / 16));

/** DCT 8×8 thẳng theo định nghĩa: chậm nhưng ảnh 40px chỉ có vài chục khối. */
function forwardDct(block: Float32Array, out: Float32Array) {
  for (let v = 0; v < 8; v++) {
    for (let u = 0; u < 8; u++) {
      let sum = 0;
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          sum += block[y * 8 + x] * COS[x * 8 + u] * COS[y * 8 + v];
        }
      }
      const cu = u === 0 ? Math.SQRT1_2 : 1;
      const cv = v === 0 ? Math.SQRT1_2 : 1;
      out[v * 8 + u] = 0.25 * cu * cv * sum;
    }
  }
}

class BitWriter {
  private bytes: number[] = [];
  private buffer = 0;
  private count = 0;

  write(code: number, size: number) {
    for (let i = size - 1; i >= 0; i--) {
      this.buffer = (this.buffer << 1) | ((code >> i) & 1);
      if (++this.count === 8) this.flushByte();
    }
  }

  private flushByte() {
    this.bytes.push(this.buffer);
    // 0xFF trong dữ liệu ảnh phải chèn thêm 0x00 phía sau (byte stuffing), nếu không sẽ bị hiểu là marker
    if (this.buffer === 0xff) this.bytes.push(0);
    this.buffer = 0;
    this.count = 0;
  }

  finish() {
    // phần bit lẻ cuối cùng được đệm bằng bit 1
    if (this.count > 0) this.write((1 << (8 - this.count)) - 1, 8 - this.count);
    return new Uint8Array(this.bytes);
  }
}

/** Số bit cần để biểu diễn |value| (category trong JPEG) và phần bit bổ sung. */
function category(value: number) {
  const abs = Math.abs(value);
  let size = 0;
  while (abs >> size) size++;
  const bits = value >= 0 ? value : value + (1 << size) - 1;
  return { size, bits };
}

function encodeBlock(
  pixels: Float32Array,
  quant: Uint8Array,
  dcTable: HuffmanTable,
  acTable: HuffmanTable,
  prevDc: number,
  writer: BitWriter,
) {
  const coeffs = new Float32Array(64);
  forwardDct(pixels, coeffs);
  const q = new Int32Array(64);
  for (let k = 0; k < 64; k++) q[k] = Math.round(coeffs[ZIGZAG[k]] / quant[k]);

  const diff = q[0] - prevDc;
  const dc = category(diff);
  writer.write(dcTable.codes[dc.size], dcTable.sizes[dc.size]);
  if (dc.size) writer.write(dc.bits, dc.size);

  let run = 0;
  for (let k = 1; k < 64; k++) {
    if (q[k] === 0) {
      run++;
      continue;
    }
    while (run > 15) {
      writer.write(acTable.codes[0xf0], acTable.sizes[0xf0]); // ZRL: 16 số 0 liên tiếp
      run -= 16;
    }
    const ac = category(q[k]);
    const symbol = (run << 4) | ac.size;
    writer.write(acTable.codes[symbol], acTable.sizes[symbol]);
    writer.write(ac.bits, ac.size);
    run = 0;
  }
  if (run > 0) writer.write(acTable.codes[0], acTable.sizes[0]); // EOB
  return q[0];
}

/**
 * ImageData (≤ 255px) → stripped bytes. Lấy mẫu màu 4:2:0 như SOF0 trong header quy định:
 * mỗi khối 16×16 (MCU) gồm 4 khối Y, 1 khối Cb, 1 khối Cr.
 */
export function encodeStripped(image: ImageData): Uint8Array {
  const { width, height, data } = image;
  if (width > MAX_STRIPPED_SIZE || height > MAX_STRIPPED_SIZE) {
    throw new RangeError(`Stripped thumbnail tối đa ${MAX_STRIPPED_SIZE}px`);
  }
  const { quant, dc, ac } = readTables();
  const writer = new BitWriter();
  const prev = [0, 0, 0];
  const block = new Float32Array(64);

  const sample = (x: number, y: number, channel: 0 | 1 | 2) => {
    const px = Math.min(x, width - 1);
    const py = Math.min(y, height - 1);
    const i = (py * width + px) * 4;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    if (channel === 0) return 0.299 * r + 0.587 * g + 0.114 * b;
    if (channel === 1) return -0.168736 * r - 0.331264 * g + 0.5 * b + 128;
    return 0.5 * r - 0.418688 * g - 0.081312 * b + 128;
  };

  for (let my = 0; my < height; my += 16) {
    for (let mx = 0; mx < width; mx += 16) {
      // 4 khối độ sáng (Y)
      for (const [bx, by] of [
        [0, 0],
        [8, 0],
        [0, 8],
        [8, 8],
      ]) {
        for (let y = 0; y < 8; y++) {
          for (let x = 0; x < 8; x++) block[y * 8 + x] = sample(mx + bx + x, my + by + y, 0) - 128;
        }
        prev[0] = encodeBlock(block, quant[0], dc[0], ac[0], prev[0], writer);
      }
      // Cb rồi Cr: mỗi điểm là trung bình 2×2 điểm ảnh
      for (const channel of [1, 2] as const) {
        for (let y = 0; y < 8; y++) {
          for (let x = 0; x < 8; x++) {
            const sx = mx + x * 2;
            const sy = my + y * 2;
            const avg =
              (sample(sx, sy, channel) +
                sample(sx + 1, sy, channel) +
                sample(sx, sy + 1, channel) +
                sample(sx + 1, sy + 1, channel)) /
              4;
            block[y * 8 + x] = avg - 128;
          }
        }
        prev[channel] = encodeBlock(block, quant[1], dc[1], ac[1], prev[channel], writer);
      }
    }
  }

  const body = writer.finish();
  const out = new Uint8Array(3 + body.length);
  out[0] = 1;
  out[1] = height;
  out[2] = width;
  out.set(body, 3);
  return out;
}

function hexToBytes(hex: string) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}
