/**
 * Chụp frame video / ảnh thành file (ý tưởng từ coursera.org: video-highlighting/utils/createSnapshot.ts
 * và outlook.live.com: owa-inline-image-loader/utils/tryCreateDataURIFromImage.ts).
 *
 * - Giữ đúng tỉ lệ khung hình của video, chỉ giới hạn chiều rộng.
 * - Đợi video có frame hiện tại (readyState >= HAVE_CURRENT_DATA) rồi mới vẽ.
 * - Dùng canvas.toBlob (bất đồng bộ, ra nhị phân) thay vì toDataURL rồi đổi base64 ngược lại.
 * - Canvas bị "taint" (vẽ nội dung khác origin không có CORS) thì báo lỗi rõ ràng.
 */

export class TaintedCanvasError extends Error {
  constructor() {
    super(
      'Canvas đã vẽ nội dung khác origin mà không có CORS nên không đọc ra được. ' +
        'Thêm crossOrigin="anonymous" cho <video>/<img> và header Access-Control-Allow-Origin ở server.',
    );
    this.name = 'TaintedCanvasError';
  }
}

export interface SnapshotOptions {
  /** chiều rộng tối đa của ảnh, chiều cao tính theo tỉ lệ của video */
  maxWidth?: number;
  type?: 'image/jpeg' | 'image/png' | 'image/webp';
  /** chất lượng 0..1, chỉ áp dụng cho jpeg/webp */
  quality?: number;
}

const HAVE_CURRENT_DATA = 2;

/** Đợi video có ít nhất một frame để vẽ. */
export function waitForFrame(video: HTMLVideoElement): Promise<void> {
  if (video.readyState >= HAVE_CURRENT_DATA && video.videoWidth > 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const done = () => {
      video.removeEventListener('loadeddata', done);
      video.removeEventListener('error', fail);
      resolve();
    };
    const fail = () => {
      video.removeEventListener('loadeddata', done);
      video.removeEventListener('error', fail);
      reject(new Error('Video không tải được'));
    };
    video.addEventListener('loadeddata', done);
    video.addEventListener('error', fail);
  });
}

/** Kích thước ảnh giữ tỉ lệ của nguồn, không phóng to quá kích thước gốc. */
export function fitSize(sourceWidth: number, sourceHeight: number, maxWidth: number) {
  const width = Math.min(maxWidth, sourceWidth);
  return { width, height: Math.round((width * sourceHeight) / sourceWidth) };
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('toBlob trả về null'))), type, quality);
    } catch (error) {
      // canvas bị taint: toBlob ném SecurityError ngay lúc gọi
      reject(error instanceof DOMException && error.name === 'SecurityError' ? new TaintedCanvasError() : error);
    }
  });
}

export async function captureVideoFrame(
  video: HTMLVideoElement,
  { maxWidth = 960, type = 'image/jpeg', quality = 0.85 }: SnapshotOptions = {},
): Promise<Blob> {
  await waitForFrame(video);
  const { width, height } = fitSize(video.videoWidth, video.videoHeight, maxWidth);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d')!.drawImage(video, 0, 0, width, height);
  return canvasToBlob(canvas, type, quality);
}

/**
 * Ảnh trên trang → data URL (Outlook dùng khi copy: ảnh đính kèm cần đăng nhập mới xem được,
 * đổi sang data URL thì dán vào app khác vẫn hiện). Trả về null nếu không làm được.
 */
export function imageToDataUrl(img: HTMLImageElement, type = 'image/png'): string | null {
  let width = img.naturalWidth;
  let height = img.naturalHeight;
  if (!(width > 0 && height > 0)) {
    // vd SVG không khai báo kích thước: dùng kích thước đang hiển thị
    width = img.width;
    height = img.height;
  }
  if (!(width > 0 && height > 0)) return null;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  // truyền width/height: drawImage(img, 0, 0) vẽ theo kích thước gốc, sai khi đang dùng kích thước hiển thị
  canvas.getContext('2d')!.drawImage(img, 0, 0, width, height);
  try {
    return canvas.toDataURL(type);
  } catch {
    return null; // canvas bị taint
  }
}

/** data URL → Blob. Có sẵn `fetch(dataUrl).then(r => r.blob())`; bản vòng lặp này chạy cả ở nơi chặn fetch data:. */
export function dataUrlToBlob(dataUrl: string): Blob {
  const [header, base64] = dataUrl.split(',');
  const mime = header.slice(header.indexOf(':') + 1, header.indexOf(';'));
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/** Canvas đã bị taint chưa: thử đọc 1 pixel. */
export function isTainted(canvas: HTMLCanvasElement) {
  try {
    canvas.getContext('2d')!.getImageData(0, 0, 1, 1);
    return false;
  } catch {
    return true;
  }
}
