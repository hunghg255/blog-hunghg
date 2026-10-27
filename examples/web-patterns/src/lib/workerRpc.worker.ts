/**
 * Worker cho demo workerRpc: vài hàm nặng để thấy Promise, tiến độ và huỷ hoạt động.
 */
import type { CallContext } from './workerRpc';
import { expose } from './workerRpcHost';

const yieldToEventLoop = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function isPrime(n: number) {
  if (n < 2) return false;
  for (let d = 2; d * d <= n; d++) if (n % d === 0) return false;
  return true;
}

const api = {
  /** Đếm số nguyên tố ≤ limit, báo tiến độ theo từng phần, nhường event loop để nhận lệnh huỷ. */
  async countPrimes({ limit, chunk = 200_000 }: { limit: number; chunk?: number }, ctx: CallContext<number>) {
    let count = 0;
    for (let start = 0; start <= limit; start += chunk) {
      ctx.signal.throwIfAborted();
      const end = Math.min(limit, start + chunk - 1);
      for (let n = start; n <= end; n++) if (isPrime(n)) count++;
      ctx.progress(end / limit);
      // không có dòng này thì tin nhắn 'cancel' nằm chờ trong hàng đợi tới khi vòng lặp xong
      await yieldToEventLoop();
    }
    return count;
  },

  /** Cùng việc nhưng KHÔNG nhường event loop: huỷ không có tác dụng cho tới khi xong. */
  countPrimesBlocking({ limit }: { limit: number }, ctx: CallContext<number>) {
    let count = 0;
    for (let n = 0; n <= limit; n++) if (isPrime(n)) count++;
    ctx.progress(1);
    return count;
  },

  /** Trả về một ArrayBuffer lớn bằng transfer: không tốn thời gian sao chép. */
  makeBuffer({ mb }: { mb: number }, ctx: CallContext<never>) {
    const buffer = new ArrayBuffer(mb * 1024 * 1024);
    new Uint8Array(buffer).fill(7);
    ctx.transfer(buffer);
    return buffer;
  },

  fail() {
    throw new RangeError('Hàm trong worker ném lỗi');
  },

  /** Lỗi xảy ra ngoài lời gọi (trong setTimeout): không gắn được với id nào. */
  crash() {
    setTimeout(() => {
      throw new Error('worker sập ngoài luồng xử lý');
    });
    return new Promise(() => {}); // không bao giờ xong
  },
};

export type DemoWorkerApi = typeof api;

expose(api);
