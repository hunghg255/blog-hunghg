import type { Solution, SolveOptions } from './proofOfWork';
import type { PowRequest, PowResponse } from './proofOfWork.worker';

/** Chạy `solve` trong một worker riêng; abort → terminate worker ngay (không cần vòng lặp hợp tác). */
export function solveInWorker(
  { salt, message, difficulty, signal, onProgress }: Omit<SolveOptions, 'batch'>,
): Promise<Solution> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const worker = new Worker(new URL('./proofOfWork.worker.ts', import.meta.url), { type: 'module' });
    const finish = () => {
      worker.terminate();
      signal?.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      finish();
      reject(signal!.reason);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    worker.addEventListener('message', (event: MessageEvent<PowResponse>) => {
      const data = event.data;
      if (data.type === 'progress') onProgress?.(data.attempts);
      else if (data.type === 'done') {
        finish();
        resolve({ nonce: data.nonce, attempts: data.attempts, ms: data.ms });
      } else {
        finish();
        reject(new Error(data.message));
      }
    });
    worker.addEventListener('error', (event) => {
      finish();
      reject(new Error(event.message || 'worker error'));
    });
    worker.postMessage({ salt, message, difficulty } satisfies PowRequest);
  });
}
