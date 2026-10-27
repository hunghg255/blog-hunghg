/**
 * Lấy ảnh từ sự kiện paste trên mọi trình duyệt.
 * Ý tưởng từ PasteHandler của Ello (src/components/editor/PasteHandler.js), có 3 nhánh:
 *  1. clipboardData có item kiểu image/* → lấy File bằng getAsFile() (Chrome, Edge, Firefox, Safari mới)
 *  2. text là data URL "…;base64,…" → tự chuyển thành Blob
 *  3. không có gì → để trình duyệt chèn <img> vào vùng soạn thảo rồi đọc lại src
 *     (Firefox đời cũ dán ảnh dưới dạng <img src="data:…">; Safari cũ dùng "webkit-fake-url://")
 * Bản viết lại xử lý nhánh 3 bằng cách đọc text/html của clipboard thay vì đợi DOM thay đổi.
 */

export type PasteResult =
  | { kind: 'files'; files: File[] }
  | { kind: 'image-url'; url: string } // ảnh copy từ trang web khác: chỉ có URL
  | { kind: 'text'; text: string }
  | { kind: 'unsupported'; reason: string };

export function dataUrlToBlob(dataUrl: string): Blob | null {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(dataUrl.trim());
  if (!match) return null;
  const [, mime = 'application/octet-stream', isBase64, data] = match;
  if (!isBase64) return new Blob([decodeURIComponent(data)], { type: mime });
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export function readPaste(data: DataTransfer): PasteResult {
  // 1. File thật. `data.files` có ở mọi trình duyệt hiện đại; items là đường dự phòng.
  const files = Array.from(data.files).filter((f) => f.type.startsWith('image/'));
  if (files.length === 0) {
    for (const item of Array.from(data.items ?? [])) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }
  }
  if (files.length > 0) return { kind: 'files', files };

  // 2. Text là data URL
  const text = data.getData('text/plain');
  if (/^data:image\/[\w.+-]+;base64,/.test(text.trim())) {
    const blob = dataUrlToBlob(text);
    if (blob) return { kind: 'files', files: [new File([blob], 'pasted', { type: blob.type })] };
  }

  // 3. HTML có <img>: copy ảnh từ trang web (chuột phải → Copy image ở một số trình duyệt)
  const html = data.getData('text/html');
  if (html) {
    const img = new DOMParser().parseFromString(html, 'text/html').querySelector('img');
    const src = img?.getAttribute('src') ?? '';
    if (src.startsWith('data:image/')) {
      const blob = dataUrlToBlob(src);
      if (blob) return { kind: 'files', files: [new File([blob], 'pasted', { type: blob.type })] };
    }
    if (src.startsWith('webkit-fake-url:')) {
      // Safari cũ: không đọc được dữ liệu ảnh (Ello hiện thông báo xin lỗi)
      return { kind: 'unsupported', reason: 'Trình duyệt không cho đọc ảnh vừa dán' };
    }
    if (/^https?:/.test(src) && !text) return { kind: 'image-url', url: src };
  }

  if (text) return { kind: 'text', text };
  return { kind: 'unsupported', reason: 'Clipboard không có ảnh hay chữ' };
}
