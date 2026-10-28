/** Server giả cho demo/test: phục vụ một mảng byte theo header Range, có giới hạn tốc độ. */
import type { ByteRange, RangeFetcher } from './rangeStream';

/** File giả có nội dung xác định (byte i phụ thuộc i) để kiểm tra dữ liệu ghép lại có đúng không. */
export function makeFakeFile(size: number): Uint8Array {
  const out = new Uint8Array(size);
  let x = 2166136261;
  for (let i = 0; i < size; i++) {
    x = Math.imul(x ^ i, 16777619);
    out[i] = x >>> 24;
  }
  return out;
}

/** FNV-1a 32 bit, đủ để so hai dãy byte trong demo. */
export function fnv1a(bytes: Uint8Array, h = 2166136261): number {
  for (let i = 0; i < bytes.length; i++) h = Math.imul(h ^ bytes[i], 16777619);
  return h >>> 0;
}

export interface FakeServerOptions {
  chunkSize?: number;
  /** ms giữa hai chunk. */
  tickMs?: number;
  /** ms chờ trước khi có header. */
  latencyMs?: number;
  /** false: bỏ qua Range, luôn trả 200 kèm cả file (như vài CDN/proxy cấu hình sai). */
  honorRange?: () => boolean;
  /** Cắt kết nối (đóng body sớm) một lần khi đã gửi tới byte tuyệt đối này. */
  dropAtByte?: () => number | null;
}

export interface FakeServer {
  fetch: RangeFetcher;
  /** Tổng byte đã đẩy ra "mạng". */
  sent: () => number;
  requests: () => number;
}

export function fakeRangeServer(file: Uint8Array, o: FakeServerOptions = {}): FakeServer {
  const chunkSize = o.chunkSize ?? 16 * 1024;
  const tickMs = o.tickMs ?? 20;
  let sent = 0;
  let requests = 0;
  let dropped = false;
  const wait = (ms: number, signal: AbortSignal) =>
    new Promise<void>((resolve, reject) => {
      const t = setTimeout(resolve, ms);
      signal.addEventListener('abort', () => (clearTimeout(t), reject(new DOMException('Aborted', 'AbortError'))), { once: true });
    });

  const fetch: RangeFetcher = async (range: ByteRange, signal) => {
    requests++;
    await wait(o.latencyMs ?? 60, signal);
    const honor = o.honorRange ? o.honorRange() : true;
    const start = honor ? range.start : 0;
    const end = honor ? Math.min(range.end ?? file.length - 1, file.length - 1) : file.length - 1;
    let pos = start;
    const body = new ReadableStream<Uint8Array>({
      pull: async (c) => {
        try {
          await wait(tickMs, signal);
        } catch (e) {
          c.error(e);
          return;
        }
        const drop = o.dropAtByte?.();
        if (!dropped && drop != null && pos >= drop) {
          dropped = true;
          c.close(); // kết nối rớt: body kết thúc sớm
          return;
        }
        if (pos > end) {
          c.close();
          return;
        }
        const chunk = file.slice(pos, Math.min(pos + chunkSize, end + 1));
        pos += chunk.length;
        sent += chunk.length;
        c.enqueue(chunk);
      },
    });
    return { status: honor ? 206 : 200, body };
  };
  return { fetch, sent: () => sent, requests: () => requests };
}
