/// <reference lib="webworker" />
/**
 * Giải proof-of-work trong Web Worker để vòng lặp băm không chiếm main thread.
 * Huỷ: trang chính gọi worker.terminate() (xem solveInWorker trong proofOfWorkWorkerClient.ts).
 */
import { solve, type SolveOptions } from './proofOfWork';

export type PowRequest = Pick<SolveOptions, 'salt' | 'message' | 'difficulty'>;
export type PowResponse =
  | { type: 'progress'; attempts: number }
  | { type: 'done'; nonce: string; attempts: number; ms: number }
  | { type: 'error'; message: string };

const post = (msg: PowResponse) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg);

self.addEventListener('message', (event: MessageEvent<PowRequest>) => {
  let last = 0;
  solve({
    ...event.data,
    onProgress: (attempts) => {
      // báo tiến độ thưa thôi: mỗi postMessage cũng tốn công sao chép + một task bên trang chính
      if (attempts - last >= 4096) {
        last = attempts;
        post({ type: 'progress', attempts });
      }
    },
  }).then(
    (result) => post({ type: 'done', ...result }),
    (error: Error) => post({ type: 'error', message: error.message }),
  );
});
