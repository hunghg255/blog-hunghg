/// <reference lib="webworker" />
import { resizeImage, type ResizeJob, type ResizeResult } from './imageResize';
import type { PoolRequest, PoolResponse } from './workerPool';

self.onmessage = async (event: MessageEvent<PoolRequest<ResizeJob>>) => {
  const { id, payload } = event.data;
  if (payload.crash) {
    // lỗi không bắt -> sự kiện 'error' trên đối tượng Worker ở main thread (giống worker WASM bị abort)
    setTimeout(() => {
      throw new Error('Worker crash (giả lập)');
    });
    return;
  }
  try {
    const result = await resizeImage(payload);
    self.postMessage({ id, ok: true, result } satisfies PoolResponse<ResizeResult>);
  } catch (error) {
    self.postMessage({ id, ok: false, error: String(error) } satisfies PoolResponse<ResizeResult>);
  }
};
