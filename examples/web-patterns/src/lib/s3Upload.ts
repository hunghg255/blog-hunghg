/**
 * Upload thẳng lên S3 bằng presigned POST, và đọc lỗi XML mà S3 trả về.
 * Ý tưởng từ utils/xml.utils.ts + hooks/useCreateImages.ts của Tribe.
 */

export interface S3Error {
  code: string | null;
  message: string | null;
  requestId: string | null;
}

/**
 * S3 trả lỗi dạng XML: <Error><Code>AccessDenied</Code><Message>…</Message>…</Error>.
 * Trả về null nếu body không phải lỗi XML của S3 (vd trang HTML 502 của proxy).
 */
export function parseS3Error(body: unknown): S3Error | null {
  if (typeof body !== 'string' || !body.trimStart().startsWith('<')) return null;
  const doc = new DOMParser().parseFromString(body, 'application/xml');
  // DOMParser KHÔNG ném lỗi khi XML hỏng: nó trả về document có chèn <parsererror>
  // (Chromium còn giữ phần đã parse được, nên root vẫn có thể là <Error> bị cụt).
  if (doc.getElementsByTagName('parsererror').length > 0) return null;
  const root = doc.documentElement;
  if (root.nodeName !== 'Error') return null;
  const text = (tag: string) => root.getElementsByTagName(tag)[0]?.textContent ?? null;
  return { code: text('Code'), message: text('Message'), requestId: text('RequestId') };
}

/** Câu thông báo cho người dùng cuối; `message` gốc của S3 viết cho lập trình viên. */
export function friendlyS3Message(error: S3Error | null, status: number): string {
  switch (error?.code) {
    case 'EntityTooLarge':
      return 'File quá lớn so với giới hạn cho phép.';
    case 'EntityTooSmall':
      return 'File quá nhỏ hoặc rỗng.';
    case 'AccessDenied':
      return 'Link upload đã hết hạn hoặc không hợp lệ. Hãy thử lại.';
    case 'SignatureDoesNotMatch':
      return 'Chữ ký upload không khớp (dữ liệu gửi khác với lúc tạo link).';
    case 'RequestTimeTooSkewed':
      return 'Đồng hồ máy bạn đang lệch nhiều so với giờ thật. Hãy chỉnh lại giờ hệ thống.';
    default:
      if (status === 0) return 'Mất kết nối mạng.';
      return error?.message ?? `Upload thất bại (HTTP ${status}).`;
  }
}

/**
 * FormData cho presigned POST. Thứ tự field CÓ ý nghĩa: S3 bỏ qua mọi field nằm sau `file`,
 * nên các field của policy phải đứng trước và `file` luôn là field cuối cùng.
 */
export function buildPresignedPostForm(fields: Record<string, string>, file: Blob, fileName?: string): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  if (!('Content-Type' in fields) && file.type) form.append('Content-Type', file.type);
  form.append('file', file, fileName ?? (file instanceof File ? file.name : 'blob'));
  return form;
}
