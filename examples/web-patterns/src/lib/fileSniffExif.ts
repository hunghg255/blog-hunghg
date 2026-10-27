/**
 * Đọc EXIF Orientation (tag 0x0112) từ JPEG mà không cần thư viện.
 * Ello dùng `exif-js` để đọc toàn bộ EXIF; ở đây chỉ cần đúng một tag nên tự parse cho gọn.
 *
 * Cấu trúc: JPEG = chuỗi segment [0xFF, marker, độ dài 2 byte big-endian, dữ liệu].
 * EXIF nằm trong segment APP1 (0xFFE1), bắt đầu bằng "Exif\0\0", theo sau là một file TIFF thu nhỏ:
 * "II" (little-endian) hoặc "MM" (big-endian), số 42, offset tới IFD0, rồi danh sách tag 12 byte/tag.
 */

/** 1 = bình thường; 3 = xoay 180°; 6 = cần xoay 90° theo chiều kim đồng hồ; 8 = xoay 90° ngược chiều.
 *  2, 4, 5, 7 là các biến thể lật gương. */
export type Orientation = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export function readJpegOrientation(buffer: ArrayBuffer): Orientation | null {
  const view = new DataView(buffer);
  if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return null; // không phải JPEG

  let offset = 2;
  while (offset + 4 <= view.byteLength) {
    if (view.getUint8(offset) !== 0xff) return null; // lệch khỏi ranh giới segment: file hỏng
    const marker = view.getUint8(offset + 1);
    // SOS (0xDA): bắt đầu dữ liệu ảnh nén, EXIF luôn nằm trước đó
    if (marker === 0xda) return null;
    const length = view.getUint16(offset + 2); // tính cả 2 byte độ dài, không tính 0xFF + marker
    if (marker === 0xe1) {
      const orientation = readExifSegment(view, offset + 4, length - 2);
      if (orientation !== undefined) return orientation;
    }
    offset += 2 + length;
  }
  return null;
}

function readExifSegment(view: DataView, start: number, length: number): Orientation | null | undefined {
  if (start + length > view.byteLength || length < 14) return undefined;
  // "Exif\0\0"; APP1 cũng có thể là XMP, khi đó bỏ qua và tìm segment tiếp theo
  if (view.getUint32(start) !== 0x45786966 || view.getUint16(start + 4) !== 0) return undefined;

  const tiff = start + 6;
  const byteOrder = view.getUint16(tiff);
  if (byteOrder !== 0x4949 && byteOrder !== 0x4d4d) return null;
  const little = byteOrder === 0x4949; // "II" = Intel = little-endian
  if (view.getUint16(tiff + 2, little) !== 42) return null;

  const ifd0 = tiff + view.getUint32(tiff + 4, little);
  if (ifd0 + 2 > start + length) return null;
  const count = view.getUint16(ifd0, little);
  for (let i = 0; i < count; i++) {
    const entry = ifd0 + 2 + i * 12;
    if (entry + 12 > start + length) return null;
    if (view.getUint16(entry, little) === 0x0112) {
      // kiểu SHORT (3), giá trị nằm luôn trong 2 byte đầu của ô value
      const value = view.getUint16(entry + 8, little);
      return value >= 1 && value <= 8 ? (value as Orientation) : null;
    }
  }
  return null;
}

/** Orientation đổi chỗ chiều rộng và chiều cao (xoay 90°)? */
export const swapsDimensions = (o: Orientation | null) => o !== null && o >= 5;

/** CSS transform tương ứng, để xoay thủ công khi trình duyệt KHÔNG tự xoay (trình duyệt cũ). */
export function orientationTransform(o: Orientation | null): string {
  switch (o) {
    case 2: return 'scaleX(-1)';
    case 3: return 'rotate(180deg)';
    case 4: return 'scaleY(-1)';
    case 5: return 'rotate(-90deg) scaleX(-1)'; // chuyển vị (transpose)
    case 6: return 'rotate(90deg)';
    case 7: return 'rotate(90deg) scaleX(-1)';
    case 8: return 'rotate(-90deg)';
    default: return 'none';
  }
}

/** EXIF nằm ở đầu file (APP1 tối đa 64KB), nên chỉ cần đọc 128KB đầu thay vì cả ảnh 10MB. */
export async function readOrientation(file: Blob): Promise<Orientation | null> {
  return readJpegOrientation(await file.slice(0, 128 * 1024).arrayBuffer());
}
