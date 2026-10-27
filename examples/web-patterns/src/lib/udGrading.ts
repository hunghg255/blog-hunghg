/**
 * Chấm code bất đồng bộ qua kênh realtime (ý tưởng từ coding exercise của Udemy).
 *
 * - Đăng ký kênh realtime XONG mới gửi bài: server chấm nhanh cỡ nào cũng không mất kết quả.
 * - Không có tin trong `idleMs` (mất kết nối, server im lặng) thì chuyển sang hỏi lại bằng HTTP,
 *   và chỉ chấp nhận kết quả khi server báo đã chấm xong.
 * - Payload có thể bị nén gzip: giải bằng DecompressionStream có sẵn của trình duyệt.
 */

export interface GradeResult {
  passed: boolean;
  /** log biên dịch / chạy test, để phân loại lỗi */
  compileLogs: string;
  testLogs: string;
}

export type GradeSource = 'realtime' | 'fallback';

/** Kênh realtime tối giản (Pusher, Ably, WebSocket tự viết… đều map được về interface này). */
export interface RealtimeClient {
  subscribe(
    channel: string,
    handlers: {
      onSubscribed: () => void;
      onMessage: (data: unknown) => void;
      onError: (reason: string) => void;
    },
  ): () => void;
}

export interface GradeOptions {
  client: RealtimeClient;
  /** gửi bài kèm tên kênh để server biết bắn kết quả vào đâu */
  submit: (channel: string) => Promise<void>;
  /** hỏi lại kết quả qua HTTP; `null` = server chưa chấm xong */
  fetchResult: () => Promise<GradeResult | null>;
  /** không nhận được gì trong khoảng này thì chuyển sang hỏi lại (Udemy dùng 45s) */
  idleMs?: number;
  /** số lần hỏi lại và khoảng cách giữa các lần */
  fallbackAttempts?: number;
  fallbackIntervalMs?: number;
  signal?: AbortSignal;
}

/** Tên kênh khó đoán: ai biết tên kênh công khai là nghe được kết quả. */
export function createChannelName() {
  return `grade-${crypto.randomUUID()}`;
}

/** Kết quả có thể là object, chuỗi JSON, hoặc bytes gzip của chuỗi JSON. */
export async function decodePayload(raw: unknown): Promise<unknown> {
  if (raw instanceof Uint8Array) {
    const stream = new Blob([raw as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream('gzip'));
    return JSON.parse(await new Response(stream).text());
  }
  if (typeof raw === 'string') return JSON.parse(raw);
  return raw;
}

export async function gzipJson(value: unknown): Promise<Uint8Array> {
  const stream = new Blob([JSON.stringify(value)]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Phân loại kết quả như Udemy: có log biên dịch là lỗi biên dịch, không có là sai test. */
export function classifyFailure(result: GradeResult): 'passed' | 'compile_error' | 'test_error' {
  if (result.passed) return 'passed';
  return result.compileLogs.length > 0 ? 'compile_error' : 'test_error';
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const id = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(id);
        reject(signal.reason);
      },
      { once: true },
    );
  });

export function gradeWithRealtime({
  client,
  submit,
  fetchResult,
  idleMs = 45_000,
  fallbackAttempts = 5,
  fallbackIntervalMs = 2_000,
  signal,
}: GradeOptions): Promise<{ result: GradeResult; source: GradeSource; channel: string }> {
  const channel = createChannelName();

  return new Promise((resolve, reject) => {
    let settled = false;
    let submitted: Promise<void> | null = null;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    let unsubscribe = () => {}; // gán sau; client có thể gọi handler ngay trong subscribe()
    const submitOnce = () => (submitted ??= submit(channel));

    const cleanup = () => {
      settled = true;
      clearTimeout(idleTimer);
      unsubscribe();
    };

    const fail = (error: unknown) => {
      if (settled) return;
      cleanup();
      reject(error);
    };

    // Đường dự phòng: hỏi lại qua HTTP cho tới khi server báo đã chấm xong.
    const fallback = async () => {
      if (settled) return;
      cleanup();
      try {
        // Kênh chưa từng subscribe được thì bài cũng chưa được gửi: gửi bù trước khi hỏi lại.
        await submitOnce();
        for (let attempt = 0; attempt < fallbackAttempts; attempt++) {
          const result = await fetchResult();
          if (result) return resolve({ result, source: 'fallback', channel });
          await sleep(fallbackIntervalMs, signal);
        }
        reject(new Error('Hết lượt hỏi lại mà server vẫn chưa chấm xong'));
      } catch (error) {
        reject(error);
      }
    };

    unsubscribe = client.subscribe(channel, {
      onSubscribed: () => {
        // Đã nghe kênh rồi mới gửi bài: kết quả về sớm cũng không bị lỡ.
        submitOnce().catch(fail);
      },
      onMessage: (raw) => {
        if (settled) return;
        decodePayload(raw).then((data) => {
          if (settled) return;
          cleanup();
          resolve({ result: data as GradeResult, source: 'realtime', channel });
        }, fail);
      },
      // Không đăng ký được kênh: chuyển ngay sang hỏi lại qua HTTP (fallback tự gửi bài nếu cần).
      onError: () => {
        if (!settled) fallback();
      },
    });

    idleTimer = setTimeout(fallback, idleMs);
    signal?.addEventListener('abort', () => fail(signal.reason), { once: true });
  });
}

/**
 * Autosave kiểu "single-flight có lượt cuối": đang có lượt hẹn thì chỉ đánh dấu,
 * lưu xong mới hẹn lượt tiếp. `flush()` huỷ lượt đang hẹn rồi lưu ngay (dùng khi bấm "Kiểm tra").
 */
export function createAutosave(save: () => Promise<void>, delayMs = 2_000) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let saving: Promise<void> | null = null;
  let dirtyWhileSaving = false;

  const run = async () => {
    timer = undefined;
    if (saving) {
      dirtyWhileSaving = true;
      return saving;
    }
    saving = save().finally(() => {
      saving = null;
      if (dirtyWhileSaving) {
        dirtyWhileSaving = false;
        schedule();
      }
    });
    return saving;
  };

  function schedule() {
    if (timer !== undefined) return; // đã hẹn, thay đổi mới sẽ đi chung lượt này
    timer = setTimeout(run, delayMs);
  }

  /** Huỷ lượt đang hẹn. Thứ tự đúng: clearTimeout TRƯỚC, xoá id SAU. */
  function cancel() {
    clearTimeout(timer);
    timer = undefined;
  }

  return {
    schedule,
    cancel,
    /** Huỷ lượt đang hẹn rồi lưu ngay. */
    flush() {
      cancel();
      return run();
    },
    get pending() {
      return timer !== undefined;
    },
  };
}
