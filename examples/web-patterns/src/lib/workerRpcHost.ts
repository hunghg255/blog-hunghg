/**
 * Phía worker của workerRpc.ts: nhận lời gọi, chạy hàm, gửi tiến độ / kết quả / lỗi về.
 * Tương đương createWorkerInterface.ts của Telegram.
 */
import type { CallContext, FromWorker, ToWorker, WorkerApi } from './workerRpc';

const post = (message: FromWorker, transfer: Transferable[] = []) => self.postMessage(message, { transfer });

export function expose(api: WorkerApi) {
  const running = new Map<number, AbortController>();

  self.addEventListener('message', async (event: MessageEvent<ToWorker>) => {
    const data = event.data;
    if (data.type === 'cancel') {
      // chỉ BẬT CỜ: hàm đang chạy phải tự kiểm tra ctx.signal (huỷ kiểu hợp tác)
      running.get(data.id)?.abort(new DOMException('cancelled', 'AbortError'));
      return;
    }

    const { id, name, input } = data;
    const controller = new AbortController();
    running.set(id, controller);
    const transfer: ArrayBuffer[] = [];
    const ctx: CallContext<unknown> = {
      signal: controller.signal,
      progress: (value) => {
        if (!controller.signal.aborted) post({ type: 'progress', id, value });
      },
      transfer: (...buffers) => transfer.push(...buffers),
    };

    try {
      const fn = api[name];
      if (!fn) throw new Error(`Không có hàm "${name}" trong worker`);
      const value = await fn(input as never, ctx as CallContext<never>);
      // đã huỷ thì phía trang chính không chờ nữa, khỏi gửi
      if (!controller.signal.aborted) post({ type: 'result', id, value }, transfer);
    } catch (error) {
      // throw 'chuỗi' hay throw null cũng phải ra một lỗi gửi được
      const err = error instanceof Error ? error : new Error(String(error));
      if (!controller.signal.aborted) post({ type: 'error', id, error: { name: err.name, message: err.message } });
    } finally {
      running.delete(id);
    }
  });

  // Lỗi không ai bắt (vd trong setTimeout): báo về để trang chính từ chối mọi lời gọi đang chờ
  self.addEventListener('error', (event) => post({ type: 'fatal', error: { message: event.message } }));
  self.addEventListener('unhandledrejection', (event) =>
    post({ type: 'fatal', error: { message: String((event.reason as Error)?.message ?? event.reason) } }),
  );
}
