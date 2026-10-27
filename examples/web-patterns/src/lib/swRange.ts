/**
 * Phía TRANG của kỹ thuật "phát media qua Service Worker bằng Range request"
 * (ý tưởng từ src/serviceWorker/progressive.ts + util/mediaLoader.ts của Telegram Web).
 *
 * <video>/<audio> tự gửi request `Range: bytes=…` khi phát và khi tua. Service worker
 * (public/sw-range.js) chặn các request đó, hỏi lại trang qua postMessage "cho tôi byte a..b",
 * trang lấy dữ liệu (Telegram: tải qua MTProto; demo: cắt từ ArrayBuffer có sẵn) rồi gửi về,
 * SW đóng gói thành response 206 Partial Content.
 */

export const PART_SIZE = 512 * 1024;
export const MEDIA_PATH = 'sw-range/media/';

export interface ByteRange {
  start: number;
  /** byte cuối, TÍNH CẢ (đúng như trong header HTTP) */
  end: number;
}

/**
 * Đọc header Range và cắt về tối đa `partSize` byte.
 * - "bytes=100-"     -> từ 100 tới hết, cắt còn 1 phần
 * - "bytes=100-199"  -> đúng đoạn đó (nếu không dài quá partSize)
 * - "bytes=-500"     -> 500 byte cuối file
 * - không có header  -> phần đầu tiên
 * Trả 'unsatisfiable' khi đoạn nằm ngoài file (-> HTTP 416).
 * Bản sao của hàm này nằm trong public/sw-range.js (SW là file tĩnh, không import được TS).
 */
export function parseRange(header: string | null, size: number, partSize = PART_SIZE): ByteRange | 'unsatisfiable' {
  if (size <= 0) return 'unsatisfiable';
  const m = /^bytes=(\d*)-(\d*)/.exec(header ?? 'bytes=0-');
  if (!m || (m[1] === '' && m[2] === '')) return 'unsatisfiable';
  let start: number;
  let end: number;
  if (m[1] === '') {
    // suffix range: N byte cuối
    start = Math.max(0, size - Number(m[2]));
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start >= size || end < start) return 'unsatisfiable';
  return { start, end: Math.min(end, start + partSize - 1) };
}

export function rangeHeaders({ start, end }: ByteRange, size: number, mime: string): Record<string, string> {
  return {
    'Content-Range': `bytes ${start}-${end}/${size}`,
    'Content-Length': String(end - start + 1),
    'Content-Type': mime,
    'Accept-Ranges': 'bytes',
  };
}

// ---------- đăng ký SW ----------

export type WorkerStatus = 'controlled' | 'needs-reload' | 'unsupported' | 'error';

/**
 * Đăng ký SW và chờ nó điều khiển trang. SW gọi clients.claim() lúc activate nên thường
 * không cần tải lại. Ngoại lệ: tải lại cứng (Shift+F5) luôn bỏ qua SW cho tới lần tải sau.
 */
export async function ensureRangeWorker(scriptUrl = './sw-range.js', scope = './'): Promise<WorkerStatus> {
  if (!('serviceWorker' in navigator)) return 'unsupported';
  try {
    await navigator.serviceWorker.register(scriptUrl, { scope });
  } catch (error) {
    console.warn('register sw-range', error);
    return 'error';
  }
  if (navigator.serviceWorker.controller) return 'controlled';
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve('needs-reload'), 4000);
    navigator.serviceWorker.addEventListener(
      'controllerchange',
      () => {
        clearTimeout(timer);
        resolve('controlled');
      },
      { once: true },
    );
  });
}

export async function unregisterRangeWorker(scriptName = 'sw-range.js') {
  if (!('serviceWorker' in navigator)) return false;
  const regs = await navigator.serviceWorker.getRegistrations();
  const mine = regs.filter((r) => (r.active ?? r.waiting ?? r.installing)?.scriptURL.endsWith(scriptName));
  const results = await Promise.all(mine.map((r) => r.unregister()));
  return results.some(Boolean);
}

// ---------- trả lời SW ----------

interface RegisteredMedia {
  buffer: ArrayBuffer;
  mime: string;
}

const registry = new Map<string, RegisteredMedia>();

/** Đăng ký dữ liệu và trả về URL để gán vào <audio src> / <video src>. */
export function registerMedia(id: string, buffer: ArrayBuffer, mime: string) {
  registry.set(id, { buffer, mime });
  // size + mime nằm luôn trong URL để SW biết tổng kích thước mà không phải hỏi
  return `./${MEDIA_PATH}${encodeURIComponent(id)}?size=${buffer.byteLength}&mime=${encodeURIComponent(mime)}`;
}

export function unregisterMedia(id: string) {
  registry.delete(id);
}

export interface PartRequest {
  type: 'requestPart';
  id: string;
  start: number;
  end: number;
}

export interface SwLog {
  type: 'sw-log';
  text: string;
  tone?: 'ok' | 'warn' | 'err' | 'muted';
}

export interface ResponderOptions {
  /** giả lập mạng chậm: ms chờ trước khi trả mỗi phần */
  delay?: () => number;
  onRequest?: (req: PartRequest) => void;
  onLog?: (log: SwLog) => void;
}

/**
 * Lắng nghe yêu cầu từ SW. Mỗi yêu cầu kèm một MessagePort riêng để trả lời
 * (bản gốc của Telegram dùng messageId + Map trong SW; MessagePort khỏi phải tự ghép cặp).
 */
export function startPartResponder({ delay = () => 0, onRequest, onLog }: ResponderOptions = {}) {
  if (!('serviceWorker' in navigator)) return () => {};

  const onMessage = async (event: MessageEvent) => {
    const data = event.data as PartRequest | SwLog | undefined;
    if (data?.type === 'sw-log') return onLog?.(data);
    if (data?.type !== 'requestPart') return;
    const port = event.ports[0];
    if (!port) return;
    onRequest?.(data);

    const media = registry.get(data.id);
    if (!media) {
      // trả lời NGAY để SW không phải chờ hết timeout (bản gốc: client im lặng, SW chờ 30s)
      port.postMessage({ error: 'not-found' });
      return;
    }
    const wait = delay();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    const part = media.buffer.slice(data.start, data.end + 1);
    // transfer: chuyển quyền sở hữu bản cắt cho SW, không sao chép lần nữa
    port.postMessage({ buffer: part, size: media.buffer.byteLength, mime: media.mime }, [part]);
  };

  navigator.serviceWorker.addEventListener('message', onMessage);
  // Tin nhắn từ SW chỉ được giao sau khi trang "bật" hàng đợi tin nhắn client
  navigator.serviceWorker.startMessages();
  return () => navigator.serviceWorker.removeEventListener('message', onMessage);
}
