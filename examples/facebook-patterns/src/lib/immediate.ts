/**
 * setImmediate tự viết (ý tưởng từ ImmediateImplementation của Facebook):
 * - Hàng đợi FIFO bằng danh sách liên kết, gọi lại bằng handle.
 * - Mỗi lần "đánh thức" chỉ gửi MỘT message; khi chạy thì làm hết các việc đã xếp hàng
 *   trước lượt đó trong cùng một task.
 * - Callback ném lỗi: phần còn lại được hẹn lượt sau rồi lỗi mới được ném tiếp
 *   (không nuốt lỗi, không bỏ rơi các việc đang xếp hàng).
 */

export type ImmediateTransport = 'message-channel' | 'post-message' | 'timeout';

type Task = { handle: number; next: Task | null };

export interface Immediate {
  setImmediate(fn: (...args: unknown[]) => void, ...args: unknown[]): number;
  clearImmediate(handle: number): void;
  readonly transport: ImmediateTransport;
  /** số lần thực sự gửi tín hiệu đánh thức (message/timer) */
  readonly wakes: number;
  dispose(): void;
}

export function createImmediate(preferred?: ImmediateTransport): Immediate {
  const callbacks = new Map<number, () => void>();
  let nextHandle = 1;
  const head: Task = { handle: 0, next: null }; // nút giả: head.next là việc kế tiếp
  let tail = head;
  let cursor = head;
  let running = false;
  let wakeScheduled = false;
  let wakes = 0;

  function drain() {
    wakeScheduled = false;
    // Chỉ chạy những việc đã có TRƯỚC lượt này. Việc được thêm trong lúc chạy đợi lượt sau,
    // nhờ vậy một chuỗi setImmediate gọi đệ quy vẫn nhường cho trình duyệt vẽ và xử lý input.
    const end = tail;
    let task: Task | null;
    while (!running && cursor !== end && (task = cursor.next)) {
      cursor = task;
      const callback = callbacks.get(task.handle);
      if (!callback) continue; // đã bị clearImmediate
      callbacks.delete(task.handle);
      running = true;
      try {
        callback();
        running = false;
      } finally {
        if (running) {
          // callback vừa ném lỗi: hẹn chạy tiếp phần còn lại rồi để lỗi bay ra ngoài
          running = false;
          if (cursor.next) wake();
        }
      }
    }
    if (!cursor.next) {
      // hàng đợi rỗng: thu hồi danh sách để không giữ nút cũ trong bộ nhớ
      head.next = null;
      tail = cursor = head;
    }
  }

  const transport: ImmediateTransport =
    preferred ??
    (typeof MessageChannel !== 'undefined'
      ? 'message-channel'
      : typeof window !== 'undefined' && typeof window.postMessage === 'function'
        ? 'post-message'
        : 'timeout');

  let wakeRaw: () => void;
  let dispose = () => {};

  if (transport === 'message-channel') {
    const channel = new MessageChannel();
    channel.port1.onmessage = drain;
    wakeRaw = () => channel.port2.postMessage(null);
    dispose = () => {
      channel.port1.onmessage = null;
      channel.port1.close();
    };
  } else if (transport === 'post-message') {
    // token ngẫu nhiên để không nhầm với message của script khác trên trang
    const token = `immediate$${Math.random().toString(36).slice(2)}`;
    const onMessage = (event: MessageEvent) => {
      if (event.source === window && event.data === token) drain();
    };
    window.addEventListener('message', onMessage);
    wakeRaw = () => window.postMessage(token, '*');
    dispose = () => window.removeEventListener('message', onMessage);
  } else {
    wakeRaw = () => setTimeout(drain, 0);
  }

  function wake() {
    if (wakeScheduled) return; // đã có một lần đánh thức đang bay: các việc mới đi chung chuyến
    wakeScheduled = true;
    wakes++;
    wakeRaw();
  }

  return {
    transport,
    get wakes() {
      return wakes;
    },
    setImmediate(fn, ...args) {
      const handle = nextHandle++;
      callbacks.set(handle, () => fn(...args));
      tail = tail.next = { handle, next: null };
      wake();
      return handle;
    },
    clearImmediate(handle) {
      callbacks.delete(handle);
    },
    dispose,
  };
}
