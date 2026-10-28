// Xoá metadata JPEG mà không re-encode, nén thumbnail vừa ngân sách byte, phát hiện frame đen.
// Viết lại từ cjjjfdegjf (cleanJPEG) và dgjacfgggf (tiện ích ảnh) của WhatsApp Web bản 2020.

export interface JpegSegment {
  marker: number;
  name: string;
  offset: number;
  /** tổng số byte của segment, gồm 2 byte marker (với SOS: gồm cả dữ liệu entropy) */
  size: number;
  /** chuỗi nhận dạng ở đầu payload APPn: "Exif", "ICC_PROFILE", "Adobe"… */
  tag?: string;
}

const NAMES: Record<number, string> = { 0xc4: 'DHT', 0xdb: 'DQT', 0xdd: 'DRI', 0xda: 'SOS', 0xd9: 'EOI', 0xfe: 'COM' };

export function markerName(m: number): string {
  if (NAMES[m]) return NAMES[m];
  if (m >= 0xe0 && m <= 0xef) return `APP${m - 0xe0}`;
  if (m >= 0xc0 && m <= 0xcf) return `SOF${m - 0xc0}`;
  return `0x${m.toString(16)}`;
}

function readTag(b: Uint8Array, at: number, max: number): string {
  let s = '';
  for (let i = at; i < at + max && b[i] >= 0x20 && b[i] < 0x7f; i++) s += String.fromCharCode(b[i]);
  return s;
}

/** Đi qua từng segment. Chịu được byte đệm 0xFF trước marker và nhiều SOS (progressive). */
export function listJpegSegments(b: Uint8Array): JpegSegment[] {
  if (b[0] !== 0xff || b[1] !== 0xd8) throw new Error('thiếu SOI ở đầu file');
  const out: JpegSegment[] = [{ marker: 0xd8, name: 'SOI', offset: 0, size: 2 }];
  let i = 2;
  while (i < b.length) {
    if (b[i] !== 0xff) throw new Error(`byte 0x${b[i].toString(16)} ở ${i} không phải marker`);
    const offset = i;
    while (b[i] === 0xff) i++; // byte đệm hợp lệ theo chuẩn
    const marker = b[i++];
    if (marker === 0xd9) {
      out.push({ marker, name: 'EOI', offset, size: i - offset });
      return out;
    }
    const len = (b[i] << 8) | b[i + 1];
    let end = i + len;
    if (marker === 0xda) {
      while (end + 1 < b.length && !(b[end] === 0xff && b[end + 1] !== 0 && (b[end + 1] < 0xd0 || b[end + 1] > 0xd7)))
        end++;
    }
    const tag = marker >= 0xe0 && marker <= 0xef ? readTag(b, i + 2, 12) : undefined;
    out.push({ marker, name: markerName(marker), offset, size: end - offset, tag });
    i = end;
  }
  throw new Error('không thấy EOI');
}

/** Segment nào là metadata riêng tư/không cần để hiển thị. */
export function isStrippable(s: JpegSegment): boolean {
  if (s.marker === 0xfe) return true; // COM
  if (s.marker < 0xe0 || s.marker > 0xef) return false;
  if (s.marker === 0xe0) return s.tag !== 'JFIF'; // giữ JFIF (mật độ điểm ảnh), bỏ JFXX chứa thumbnail
  if (s.marker === 0xe2 && s.tag === 'ICC_PROFILE') return false; // màu Display P3 của điện thoại
  if (s.marker === 0xee && s.tag?.startsWith('Adobe')) return false; // cho biết YCbCr/CMYK
  return true; // Exif, XMP, IPTC (APP13), MPF (APP2), APP3..15 lạ
}

/**
 * Bỏ metadata bằng cách chép lại các segment cần giữ: dữ liệu ảnh (DQT, DHT, SOF, SOS…) giữ nguyên
 * từng byte nên điểm ảnh không đổi. Lưu ý: Exif mang cả Orientation; chỉ dùng khi ảnh không cần xoay.
 */
export function stripJpegMetadata(b: Uint8Array): { bytes: Uint8Array<ArrayBuffer>; removed: JpegSegment[] } {
  const segs = listJpegSegments(b);
  const keep: Uint8Array[] = [];
  const removed: JpegSegment[] = [];
  for (const s of segs) {
    if (isStrippable(s)) removed.push(s);
    else keep.push(b.subarray(s.offset, s.offset + s.size));
  }
  const out = new Uint8Array(keep.reduce((n, p) => n + p.byteLength, 0));
  let at = 0;
  for (const p of keep) {
    out.set(p, at);
    at += p.byteLength;
  }
  return { bytes: out, removed };
}

export interface ExifSummary {
  orientation: number;
  make?: string;
  model?: string;
  hasGps: boolean;
}

/** Đọc vài tag IFD0 trong APP1 Exif: đủ để biết có cần xoay và có lộ GPS không. */
export function readExifSummary(b: Uint8Array): ExifSummary | null {
  const seg = listJpegSegments(b).find((s) => s.marker === 0xe1 && s.tag === 'Exif');
  if (!seg) return null;
  const tiff = seg.offset + 4 + 6;
  const view = new DataView(b.buffer, b.byteOffset);
  const le = b[tiff] === 0x49;
  const u16 = (at: number) => view.getUint16(tiff + at, le);
  const u32 = (at: number) => view.getUint32(tiff + at, le);
  const ascii = (at: number, n: number) => readTag(b, tiff + at, n);
  const ifd = u32(4);
  const out: ExifSummary = { orientation: 1, hasGps: false };
  for (let k = 0, n = u16(ifd); k < n; k++) {
    const e = ifd + 2 + k * 12;
    const tag = u16(e);
    const count = u32(e + 4);
    const value = count <= 4 ? e + 8 : u32(e + 8);
    if (tag === 0x0112) out.orientation = u16(e + 8);
    else if (tag === 0x010f) out.make = ascii(value, count);
    else if (tag === 0x0110) out.model = ascii(value, count);
    else if (tag === 0x8825) out.hasGps = true;
  }
  return out;
}

export interface BudgetResult {
  blob: Blob;
  quality: number;
  /** số lần gọi encoder */
  encodes: number;
}

export function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * Tìm chất lượng cao nhất mà file vẫn ≤ maxBytes bằng tìm kiếm nhị phân (tối đa 7 lần encode),
 * thay vì thử lần lượt 0.9, 0.8, … như bản gốc. Không vừa ở chất lượng thấp nhất thì trả null.
 */
export async function encodeWithinBudget(
  canvas: HTMLCanvasElement,
  maxBytes: number,
  type = 'image/jpeg',
  { min = 0.1, max = 0.92, steps = 6 } = {},
): Promise<BudgetResult | null> {
  let encodes = 0;
  const at = async (q: number) => {
    encodes++;
    return canvasToBlob(canvas, type, q);
  };
  const top = await at(max);
  if (top && top.size <= maxBytes) return { blob: top, quality: max, encodes };
  let best: { blob: Blob; quality: number } | null = null;
  let lo = min;
  let hi = max;
  for (let i = 0; i < steps; i++) {
    const q = i === 0 ? lo : (lo + hi) / 2;
    const blob = await at(q);
    if (blob && blob.size <= maxBytes) {
      best = { blob, quality: q };
      lo = q;
      if (blob.size >= maxBytes * 0.9) break; // đã sát ngân sách: tăng chất lượng thêm cũng không đáng
    } else if (i === 0) {
      return null; // chất lượng thấp nhất còn quá lớn: phải thu nhỏ kích thước
    } else hi = q;
  }
  return best && { ...best, encodes };
}

/**
 * Micro-thumbnail: mỗi lần chưa vừa thì thu nhỏ còn một nửa. Khác bản gốc: tôn trọng mimetype,
 * không bao giờ tạo canvas 0 px (toBlob của canvas rỗng trả null).
 */
export async function generateMicroThumb(
  source: HTMLCanvasElement,
  maxBytes: number,
  { mimetype = 'image/jpeg', maxAttempts = 10, quality = 0.8 } = {},
): Promise<{ blob: Blob; width: number; height: number; attempts: number }> {
  let canvas = source;
  let blob = await canvasToBlob(canvas, mimetype, quality);
  let attempts = 0;
  for (let scale = 0.5; attempts < maxAttempts && (!blob || blob.size > maxBytes); scale /= 2) {
    attempts++;
    const w = Math.max(1, Math.floor(source.width * scale));
    const h = Math.max(1, Math.floor(source.height * scale));
    canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d')!.drawImage(source, 0, 0, w, h);
    blob = await canvasToBlob(canvas, mimetype, quality);
    if (w === 1 && h === 1) break;
  }
  if (!blob) throw new Error(`trình duyệt không encode được ${mimetype}`);
  return { blob, width: canvas.width, height: canvas.height, attempts };
}

/** Toạ độ lấy mẫu dạng lưới phủ cả khung hình (gồm cả giữa ảnh, nơi letterbox không che). */
export function gridSamplePoints(width: number, height: number, n = 6): [number, number][] {
  const pts: [number, number][] = [];
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++) pts.push([Math.floor(((c + 0.5) * width) / n), Math.floor(((r + 0.5) * height) / n)]);
  return pts;
}

/** Frame "đen" khi mọi điểm mẫu đều gần đen. Ngưỡng nhỏ để chịu được nhiễu nén của video. */
export function isBlackFrame(img: ImageData, n = 6, threshold = 16): boolean {
  return gridSamplePoints(img.width, img.height, n).every(([x, y]) => {
    const i = 4 * (y * img.width + x);
    return img.data[i] <= threshold && img.data[i + 1] <= threshold && img.data[i + 2] <= threshold;
  });
}
