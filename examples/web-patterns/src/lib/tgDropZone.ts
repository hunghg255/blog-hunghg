/**
 * Thả file vào khung chat, nén ảnh trước khi gửi, copy ảnh/chữ, theo ý tưởng của Telegram Web A
 * (components/middle/MiddleColumn.tsx, composer/DropArea.tsx, composer/helpers/buildAttachment.ts, util/clipboard.ts).
 */

// ---------------------------------------------------------------- 1. vùng thả 1 hay 2 ô

/** Loại file gửi "nhanh" được (dạng ảnh/video có nén), giống CONTENT_TYPES_FOR_QUICK_UPLOAD của Telegram. */
export const QUICK_TYPES = new Set(['image/png', 'image/gif', 'image/jpeg', 'video/mp4', 'video/avi', 'video/quicktime']);

export type DropMode = 'none' | 'document' | 'quick';

/**
 * Quyết định ngay ở `dragenter`, lúc trình duyệt chưa cho đọc file nhưng đã cho biết `kind` và MIME:
 * - không có file nào (đang kéo chữ, kéo link): không hiện vùng thả
 * - mọi file đều gửi nhanh được: 2 ô ("dạng ảnh" và "dạng file")
 * - còn lại: 1 ô ("dạng file")
 */
export function getDropMode(items: Iterable<Pick<DataTransferItem, 'kind' | 'type'>> | null | undefined): DropMode {
  // Firefox tự thêm text/uri-list khi kéo ảnh từ trang khác: bỏ qua
  const list = Array.from(items ?? []).filter((item) => item.type !== 'text/uri-list');
  const files = list.filter((item) => item.kind === 'file');
  // Bản gốc thiếu bước này: kéo một đoạn chữ cũng hiện vùng thả "gửi dạng file"
  if (files.length === 0) return 'none';
  return files.length === list.length && files.every((f) => QUICK_TYPES.has(f.type)) ? 'quick' : 'document';
}

/**
 * Ẩn vùng thả cho đúng lúc. `dragleave` bắn cả khi con trỏ đi từ phần tử cha vào phần tử con,
 * nên chỉ tin `dragleave` có `relatedTarget == null` (ra khỏi cửa sổ hoặc bấm Esc), và hẹn 150ms;
 * `dragover` tới tiếp thì huỷ hẹn để vùng thả không nháy.
 */
export function createDropHide(onHide: () => void, delay = 150) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    dragLeave(e: Pick<DragEvent, 'relatedTarget'>) {
      if (e.relatedTarget) return;
      clearTimeout(timer);
      timer = setTimeout(onHide, delay);
    },
    dragOver() {
      clearTimeout(timer);
    },
    cancel() {
      clearTimeout(timer);
    },
  };
}

// ---------------------------------------------------------------- 2. nén ảnh trước khi gửi

export const MAX_QUICK_SIDE = 1280;

export interface SqueezeResult {
  blob: Blob;
  width: number;
  height: number;
  /** false: gửi nguyên ảnh dạng file (ảnh có trong suốt, hoặc nén lỗi) */
  asPhoto: boolean;
}

/** Kích thước sau khi thu cạnh dài về `max`, giữ tỉ lệ. */
export function fitWithin(width: number, height: number, max = MAX_QUICK_SIDE) {
  if (width <= max && height <= max) return { width, height };
  const k = max / Math.max(width, height);
  return { width: Math.round(width * k), height: Math.round(height * k) };
}

function hasTransparency(ctx: CanvasRenderingContext2D, width: number, height: number) {
  const { data } = ctx.getImageData(0, 0, width, height);
  for (let i = 3; i < data.length; i += 4 * 7) {
    if (data[i] < 255) return true;
  }
  return false;
}

/**
 * Ảnh lớn hơn 1280px hoặc không phải JPEG: vẽ lại lên canvas rồi xuất JPEG.
 * Sửa hai chỗ so với bản gốc:
 * - chất lượng truyền 0..1 (bản gốc truyền 100: ngoài khoảng, trình duyệt bỏ qua và dùng mặc định)
 * - PNG có vùng trong suốt: JPEG không có alpha nên nền thành màu đen. Gửi dạng file thay vì nén.
 * - GIF (có thể là ảnh động) gửi nguyên dạng file.
 */
export async function squeezeImage(file: Blob, quality = 0.9): Promise<SqueezeResult> {
  const bitmap = await createImageBitmap(file);
  // GIF có thể là ảnh động: vẽ lên canvas chỉ còn khung đầu. Gửi nguyên dạng file.
  if (file.type === 'image/gif') {
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return { blob: file, ...size, asPhoto: false };
  }
  const { width, height } = fitWithin(bitmap.width, bitmap.height);
  if (file.type === 'image/jpeg' && width === bitmap.width && height === bitmap.height) {
    bitmap.close();
    return { blob: file, width, height, asPhoto: true };
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  if (file.type !== 'image/jpeg' && hasTransparency(ctx, width, height)) {
    return { blob: file, width, height, asPhoto: false };
  }

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  return blob ? { blob, width, height, asPhoto: true } : { blob: file, width, height, asPhoto: false };
}

// ---------------------------------------------------------------- 3. copy ảnh và chữ

/**
 * Copy ảnh: clipboard chỉ chắc chắn nhận PNG, nên vẽ lại thành PNG.
 * Truyền PROMISE vào ClipboardItem để gọi `clipboard.write` ngay trong cú click
 * (Safari từ chối nếu gọi sau một thao tác async; bản gốc gọi trong `img.onload`).
 */
export async function copyImageToClipboard(source: Blob) {
  if (!navigator.clipboard || typeof ClipboardItem === 'undefined') throw new Error('Clipboard API không có');
  const png = (async () => {
    if (source.type === 'image/png') return source;
    const bitmap = await createImageBitmap(source);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('Không xuất được PNG');
    return blob;
  })();
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
}

/** Copy chữ: dùng API mới nếu có, không thì textarea ẩn + execCommand và trả lại vùng đang bôi của người dùng. */
export async function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // không có quyền (vd iframe thiếu allow="clipboard-write"): rơi xuống cách cũ
    }
  }
  const el = document.createElement('textarea');
  el.value = text;
  el.setAttribute('readonly', '');
  el.style.cssText = 'position:fixed;top:0;left:0;opacity:0;';
  document.body.appendChild(el);
  const selection = document.getSelection();
  const saved = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
  el.select();
  document.execCommand('copy');
  document.body.removeChild(el);
  if (saved && selection) {
    selection.removeAllRanges();
    selection.addRange(saved);
  }
}
