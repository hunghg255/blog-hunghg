/**
 * Tính kích thước đích khi thu nhỏ ảnh trước khi upload (ý tưởng từ JpegResizer của Facebook:
 * khung tối đa 2048×2048, chất lượng JPEG 85, bản "thấp" 960×960).
 */

export const RESIZE_PRESETS = {
  high: { maxWidth: 2048, maxHeight: 2048, quality: 0.85 },
  low: { maxWidth: 960, maxHeight: 960, quality: 0.85 },
} as const;

export interface ResizeJob {
  blob: Blob;
  maxWidth: number;
  maxHeight: number;
  quality: number;
  /** chỉ để demo: ép worker ném lỗi */
  crash?: boolean;
}

export interface ResizeResult {
  blob: Blob;
  /** ảnh đã nhỏ hơn khung: trả lại nguyên file, không nén lại */
  skipped: boolean;
  originalWidth: number;
  originalHeight: number;
  outputWidth: number;
  outputHeight: number;
  ms: number;
}

/** Giữ tỉ lệ, không phóng to. */
export function fitWithin(width: number, height: number, maxWidth: number, maxHeight: number) {
  const scale = Math.min(1, maxWidth / width, maxHeight / height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    scale,
  };
}

/** Thu nhỏ một ảnh. Chạy được cả trong worker (OffscreenCanvas) lẫn trên main thread. */
export async function resizeImage(job: ResizeJob): Promise<ResizeResult> {
  const start = performance.now();
  if (job.crash) throw new Error('Worker crash (giả lập)');
  // createImageBitmap giải mã ảnh; trong worker việc này không chặn main thread
  const bitmap = await createImageBitmap(job.blob);
  const { width: ow, height: oh } = bitmap;
  const target = fitWithin(ow, oh, job.maxWidth, job.maxHeight);
  if (target.scale === 1) {
    bitmap.close();
    return { blob: job.blob, skipped: true, originalWidth: ow, originalHeight: oh, outputWidth: ow, outputHeight: oh, ms: performance.now() - start };
  }
  const canvas = new OffscreenCanvas(target.width, target.height);
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, target.width, target.height);
  bitmap.close();
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: job.quality });
  return {
    blob,
    skipped: false,
    originalWidth: ow,
    originalHeight: oh,
    outputWidth: target.width,
    outputHeight: target.height,
    ms: performance.now() - start,
  };
}
