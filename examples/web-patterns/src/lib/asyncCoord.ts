/**
 * Bốn công cụ nhỏ để điều phối việc bất đồng bộ, viết lại từ Glitch và Toptal.
 *
 * 1. latestWins (Glitch `utils/track-serially.js`): nguồn sự kiện nhanh (kéo slider) điều
 *    khiển một việc chậm (gọi server). Chỉ chạy 1 việc một lúc, và chỉ giữ LỆNH MỚI NHẤT
 *    đang chờ; lệnh ở giữa bị bỏ, không bao giờ dồn hàng đợi.
 * 2. singleFlight (Toptal `lib/fetch-json-cache.js`): nhiều nơi cùng cần một URL -> chỉ một
 *    request. Bản gốc giữ lỗi mãi mãi; bản này xoá lỗi để lần sau thử lại, và có TTL.
 * 3. withTimeout (Toptal `lib/with-timeout.js`): chạy callback ĐÚNG MỘT LẦN, khi được gọi
 *    hoặc khi hết giờ, cái nào tới trước.
 * 4. exposeCallbacks (Toptal `lib/expose-callbacks.js`): biến mảng `window.x = []` mà script
 *    bên thứ ba push vào thành hàng đợi có replay cho người đến muộn.
 */

// ---------------------------------------------------------------------------
// 1. latestWins
// ---------------------------------------------------------------------------

export interface LatestWins<A extends unknown[]> {
  (...args: A): void;
  /** đang không chạy việc nào */
  readonly idle: boolean;
  /** promise resolve khi đã chạy xong lệnh mới nhất (dùng cho test, hoặc nút "Lưu và đóng") */
  whenIdle(): Promise<void>;
}

export function latestWins<A extends unknown[]>(
  task: (...args: A) => Promise<unknown>,
  onError: (error: unknown) => void = (e) => console.error(e),
): LatestWins<A> {
  let pending: A | null = null;
  let running = false;
  const idleWaiters: Array<() => void> = [];

  async function loop() {
    running = true;
    while (pending !== null) {
      const args = pending;
      pending = null;
      try {
        await task(...args);
      } catch (error) {
        // Khác Glitch: lỗi chỉ bỏ qua lệnh hiện tại. Bản gốc thoát vòng lặp khi có lỗi,
        // lệnh mới nhất đang chờ nằm im cho tới khi người dùng thao tác thêm lần nữa.
        onError(error);
      }
    }
    running = false;
    idleWaiters.splice(0).forEach((resolve) => resolve());
  }

  const run = ((...args: A) => {
    pending = args; // ghi đè lệnh đang chờ (nếu có)
    if (!running) void loop();
  }) as LatestWins<A>;

  Object.defineProperty(run, 'idle', { get: () => !running });
  run.whenIdle = () => (running ? new Promise<void>((resolve) => idleWaiters.push(resolve)) : Promise.resolve());
  return run;
}

// ---------------------------------------------------------------------------
// 2. singleFlight
// ---------------------------------------------------------------------------

export interface SingleFlightOptions {
  /** giữ kết quả thành công bao lâu (ms). Mặc định: mãi mãi như Toptal */
  ttl?: number;
}

export function singleFlight<K, V>(load: (key: K) => Promise<V>, { ttl = Infinity }: SingleFlightOptions = {}) {
  const entries = new Map<K, { promise: Promise<V>; settledAt?: number }>();

  return {
    get(key: K): Promise<V> {
      const entry = entries.get(key);
      const fresh = entry && (entry.settledAt === undefined || Date.now() - entry.settledAt < ttl);
      if (entry && fresh) return entry.promise;

      const promise = load(key).then(
        (value) => {
          const current = entries.get(key);
          if (current?.promise === promise) current.settledAt = Date.now();
          return value;
        },
        (error) => {
          // lỗi KHÔNG được cache: người gọi tiếp theo sẽ thử lại
          if (entries.get(key)?.promise === promise) entries.delete(key);
          throw error;
        },
      );
      entries.set(key, { promise });
      return promise;
    },
    invalidate(key?: K) {
      if (key === undefined) entries.clear();
      else entries.delete(key);
    },
  };
}

// ---------------------------------------------------------------------------
// 3. withTimeout
// ---------------------------------------------------------------------------

export function withTimeout<A extends unknown[]>(callback: (...args: A | []) => void, timeout = 1000) {
  let done = false;
  const fire = (...args: A | []) => {
    if (done) return;
    done = true;
    clearTimeout(timer); // bản gốc để timer chạy tiếp (vô hại nhưng giữ closure thêm 1 giây)
    callback(...args);
  };
  const timer = setTimeout(() => fire(), timeout);
  return fire;
}

// ---------------------------------------------------------------------------
// 4. exposeCallbacks
// ---------------------------------------------------------------------------

type Callback<A extends unknown[]> = (...args: A) => void;

export class CallbackQueue<A extends unknown[]> {
  private triggered = false;
  private args = [] as unknown as A;
  private callbacks: Array<Callback<A>> = [];
  constructor(private onError: (error: unknown) => void = (e) => console.error(e)) {}

  /** Cùng chữ ký với Array#push, nên code `window.x.push(cb)` của bên thứ ba vẫn chạy. */
  push = (...callbacks: Array<Callback<A>>) => {
    for (const cb of callbacks) {
      if (this.triggered) this.safeCall(cb);
      else this.callbacks.push(cb);
    }
    return this.callbacks.length;
  };

  trigger(...args: A) {
    if (this.triggered) throw new Error('Callbacks already triggered');
    this.triggered = true;
    this.args = args;
    this.callbacks.splice(0).forEach((cb) => this.safeCall(cb));
  }

  get isTriggered() {
    return this.triggered;
  }

  // Khác Toptal: một callback của bên thứ ba ném lỗi không được chặn các callback sau nó
  private safeCall(cb: Callback<A>) {
    try {
      cb(...this.args);
    } catch (error) {
      this.onError(error);
    }
  }
}

export function exposeCallbacks<A extends unknown[]>(
  name: string,
  target: Record<string, unknown> = window as never,
  onError?: (error: unknown) => void,
) {
  const existing = target[name];
  if (existing instanceof CallbackQueue) return existing as CallbackQueue<A>;

  const queue = new CallbackQueue<A>(onError);
  // script bên thứ ba chạy TRƯỚC app: `window[name] = window[name] || []; window[name].push(cb)`
  if (Array.isArray(existing)) queue.push(...(existing as Array<Callback<A>>));
  else if (existing !== undefined) console.warn(`exposeCallbacks: window.${name} có kiểu lạ, ghi đè`);
  target[name] = queue;
  return queue;
}
