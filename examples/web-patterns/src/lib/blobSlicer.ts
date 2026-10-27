/**
 * Upload file lớn theo từng lát (slice/chunk), ý tưởng từ owa-blob-slicer của Outlook Web:
 *   lát ĐẦU chạy một mình -> các lát GIỮA chạy song song (giới hạn số luồng) -> lát CUỐI chạy một mình.
 * Lát đầu lỗi (sai quyền, hết hạn session…) thì dừng sớm, không phí băng thông cho cả file.
 * Lát cuối thường là lát "chốt" (server ghép file, trả về 201), nên chỉ gửi khi mọi lát khác đã xong.
 *
 * Thêm so với bản gốc: huỷ được cả request đang chạy (AbortSignal), thử lại từng lát khi lỗi tạm thời,
 * tiến độ tính theo byte cho cả khi chạy song song.
 */

export interface SliceRange {
  index: number;
  /** byte đầu (tính cả) */
  start: number;
  /** byte cuối (KHÔNG tính), dùng thẳng cho blob.slice(start, end) */
  end: number;
}

export function createSliceRanges(size: number, sliceSize: number): SliceRange[] {
  if (!(sliceSize > 0)) throw new RangeError('sliceSize phải > 0');
  const ranges: SliceRange[] = [];
  for (let start = 0, index = 0; start < size; start += sliceSize, index++) {
    ranges.push({ index, start, end: Math.min(start + sliceSize, size) });
  }
  return ranges; // file rỗng -> [] (upload session thường không nhận file 0 byte, dùng API upload đơn)
}

/** Header Content-Range của HTTP tính byte cuối TÍNH CẢ: lát [0, 10) là "bytes 0-9/total". */
export const contentRange = (range: SliceRange, total: number) => `bytes ${range.start}-${range.end - 1}/${total}`;

export class HttpError extends Error {
  constructor(
    public status: number,
    message = `HTTP ${status}`,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

/** Lỗi mạng, 5xx, 408, 429: thử lại có thể được. 4xx còn lại (sai quyền, sai thứ tự…) thì không. */
export function isRetryable(error: unknown) {
  if (error instanceof HttpError) return error.status >= 500 || error.status === 408 || error.status === 429;
  return !(error instanceof DOMException && error.name === 'AbortError');
}

export interface SliceContext {
  signal: AbortSignal;
  totalSlices: number;
  attempt: number;
  /** báo số byte của lát này đã gửi được (vd từ xhr.upload.onprogress) */
  onProgress: (loaded: number) => void;
}

export type SliceAction = (slice: Blob, range: SliceRange, ctx: SliceContext) => Promise<void>;

export type SliceState = 'uploading' | 'retrying' | 'done' | 'failed' | 'aborted';

export interface SlicedUploadOptions {
  sliceSize?: number;
  /** số lát giữa chạy cùng lúc. Server không nhận lát lệch thứ tự (như OneDrive) thì để 1. */
  parallel?: number;
  /** số lần thử lại cho MỖI lát */
  retries?: number;
  retryDelay?: (attempt: number) => number;
  onProgress?: (uploaded: number, total: number) => void;
  onSliceState?: (range: SliceRange, state: SliceState, error?: unknown) => void;
}

export interface SlicedUpload {
  ranges: SliceRange[];
  /** 'completed' hoặc 'cancelled'; lỗi không thử lại được thì reject */
  done: Promise<'completed' | 'cancelled'>;
  cancel: () => void;
}

function wait(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const timer = setTimeout(done, ms);
    function done() {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }
    function onAbort() {
      clearTimeout(timer);
      reject(signal.reason);
    }
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export function startSlicedUpload(blob: Blob, action: SliceAction, options: SlicedUploadOptions = {}): SlicedUpload {
  const {
    sliceSize = 10 * 1024 * 1024,
    parallel = 2,
    retries = 2,
    retryDelay = (attempt) => 500 * 2 ** attempt,
    onProgress,
    onSliceState,
  } = options;

  const ranges = createSliceRanges(blob.size, sliceSize);
  const controller = new AbortController();
  const { signal } = controller;
  let cancelled = false;

  const loaded = new Map<number, number>();
  const report = () => {
    let sum = 0;
    loaded.forEach((n) => (sum += n));
    onProgress?.(sum, blob.size);
  };

  async function runSlice(range: SliceRange) {
    for (let attempt = 0; ; attempt++) {
      signal.throwIfAborted();
      onSliceState?.(range, attempt === 0 ? 'uploading' : 'retrying');
      try {
        await action(blob.slice(range.start, range.end), range, {
          signal,
          attempt,
          totalSlices: ranges.length,
          onProgress: (n) => {
            loaded.set(range.index, Math.min(n, range.end - range.start));
            report();
          },
        });
        loaded.set(range.index, range.end - range.start);
        report();
        onSliceState?.(range, 'done');
        return;
      } catch (error) {
        if (signal.aborted) {
          // bị huỷ (người dùng bấm huỷ, hoặc một lát khác hỏng hẳn): không thử lại
          loaded.set(range.index, 0);
          report();
          onSliceState?.(range, 'aborted');
          throw signal.reason;
        }
        loaded.set(range.index, 0); // lần gửi sau bắt đầu lại từ đầu lát
        report();
        if (attempt >= retries || !isRetryable(error)) {
          onSliceState?.(range, 'failed', error);
          throw error;
        }
        await wait(retryDelay(attempt), signal);
      }
    }
  }

  // Hàng đợi có giới hạn số luồng: mỗi "luồng" lấy lát kế tiếp khi xong lát của mình
  async function runPool(list: SliceRange[], concurrency: number) {
    let next = 0;
    const lane = async () => {
      while (next < list.length && !signal.aborted) await runSlice(list[next++]);
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, list.length) }, lane));
  }

  const done = (async () => {
    if (ranges.length === 0) return 'completed' as const;
    try {
      await runSlice(ranges[0]);
      await runPool(ranges.slice(1, -1), Math.max(1, parallel));
      if (ranges.length > 1) await runSlice(ranges[ranges.length - 1]);
      return 'completed' as const;
    } catch (error) {
      if (cancelled) return 'cancelled' as const;
      // Một lát hỏng hẳn: huỷ các lát song song khác đang chạy, khỏi gửi tiếp vô ích
      controller.abort(error);
      throw error;
    }
  })();

  return {
    ranges,
    done,
    cancel() {
      if (cancelled) return;
      cancelled = true;
      controller.abort(new DOMException('Upload cancelled', 'AbortError'));
    },
  };
}
