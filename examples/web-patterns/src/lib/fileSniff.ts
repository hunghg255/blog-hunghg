/**
 * Nhận loại file thật bằng "magic number" (vài byte đầu file), không tin đuôi file hay `file.type`.
 * Ý tưởng từ `isValidFileType` của Ello (src/helpers/file_helper.js), viết lại so sánh theo byte.
 */

export type SniffedType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' | 'image/bmp';

interface Signature {
  type: SniffedType;
  /** vị trí bắt đầu so khớp */
  offset: number;
  /** null = byte nào cũng được */
  bytes: Array<number | null>;
}

const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0));

const SIGNATURES: Signature[] = [
  { type: 'image/jpeg', offset: 0, bytes: [0xff, 0xd8, 0xff] },
  { type: 'image/png', offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { type: 'image/gif', offset: 0, bytes: ascii('GIF8') }, // GIF87a / GIF89a
  // RIFF....WEBP: 4 byte ở giữa là kích thước file, bỏ qua
  { type: 'image/webp', offset: 0, bytes: [...ascii('RIFF'), null, null, null, null, ...ascii('WEBP')] },
  { type: 'image/bmp', offset: 0, bytes: ascii('BM') },
];

/** Số byte đầu cần đọc để nhận đủ mọi chữ ký ở trên. */
export const SNIFF_LENGTH = 12;

export function sniffImageType(head: Uint8Array): SniffedType | null {
  for (const sig of SIGNATURES) {
    if (head.length < sig.offset + sig.bytes.length) continue;
    const match = sig.bytes.every((b, i) => b === null || head[sig.offset + i] === b);
    if (match) return sig.type;
  }
  return null;
}

/** Đọc vài byte đầu của một File/Blob mà không đọc cả file vào bộ nhớ. */
export async function readHead(blob: Blob, length = SNIFF_LENGTH): Promise<Uint8Array> {
  return new Uint8Array(await blob.slice(0, length).arrayBuffer());
}

export interface SniffResult {
  /** loại thật theo nội dung, null nếu không phải ảnh được hỗ trợ */
  type: SniffedType | null;
  /** loại trình duyệt đoán (từ đuôi file / hệ điều hành) */
  declaredType: string;
  /** đuôi file và nội dung không khớp: ảnh PNG đặt tên .jpg, file .exe đổi tên thành .png… */
  mismatch: boolean;
}

export async function sniffFile(file: File | Blob): Promise<SniffResult> {
  const type = sniffImageType(await readHead(file));
  const declaredType = file.type;
  // image/jpg không phải MIME chuẩn nhưng vẫn gặp ngoài đời: coi như image/jpeg
  const normalized = declaredType === 'image/jpg' ? 'image/jpeg' : declaredType;
  // lệch khi: nội dung là ảnh nhưng khai báo loại khác, hoặc khai báo là ảnh mà nội dung không phải
  const mismatch =
    normalized !== '' && normalized !== type && (type !== null || normalized.startsWith('image/'));
  return { type, declaredType, mismatch };
}
