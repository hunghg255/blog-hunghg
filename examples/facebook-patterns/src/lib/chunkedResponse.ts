/**
 * Đọc một response "nhiều mẩu JSON" ngay khi từng mẩu về, và chống JSON hijacking bằng
 * tiền tố `for (;;);` (ý tưởng từ CSRFGuard và ChunkedRequest của Facebook).
 *
 * Server trả về:   for (;;);{"a":1}\r\n{"b":2}\r\n{"c":3}
 *  - `<script src>` của trang khác nạp URL này sẽ kẹt trong vòng lặp vô hạn, không đọc được dữ liệu
 *  - code của chính trang đọc bằng fetch/XHR, bỏ tiền tố rồi JSON.parse từng mẩu
 */

export const GUARD = 'for (;;);';
const GUARD_RE = /^for ?\(;;\);/;

/**
 * Bỏ tiền tố bảo vệ. Giống bản gốc: KHÔNG có tiền tố thì trả null (không âm thầm chấp nhận),
 * để phát hiện sớm response không đi qua lớp bảo vệ.
 */
export function stripGuard(text: string): string | null {
  const m = GUARD_RE.exec(text);
  return m ? text.slice(m[0].length) : null;
}

/**
 * Tách luồng text thành các mẩu theo dấu phân cách, nhớ vị trí đã đọc.
 * Gọi lại với toàn bộ text đã nhận (XHR) hoặc qua `push` từng phần (fetch stream).
 */
export class ChunkParser {
  private offset = 0;
  private buffer = '';

  constructor(private readonly delimiter = '\r\n') {}

  /** Nhận phần text mới; trả các mẩu đã trọn vẹn. */
  push(text: string): string[] {
    this.buffer += text;
    return this.drain(false);
  }

  /** Kết thúc luồng: trả nốt phần còn lại nếu nó không rỗng. */
  end(): string[] {
    return this.drain(true);
  }

  private drain(final: boolean): string[] {
    const out: string[] = [];
    let start = this.offset;
    let idx = this.buffer.indexOf(this.delimiter, start);
    while (idx !== -1) {
      const piece = this.buffer.slice(start, idx);
      if (piece) out.push(piece);
      start = idx + this.delimiter.length;
      idx = this.buffer.indexOf(this.delimiter, start);
    }
    this.offset = start;
    if (final) {
      const rest = this.buffer.slice(this.offset);
      // khác bản gốc: luôn phát mẩu cuối (kể cả khi không có dấu phân cách theo sau),
      // nhưng không phát mẩu rỗng khi luồng kết thúc đúng bằng dấu phân cách
      if (rest) out.push(rest);
      this.offset = this.buffer.length;
    }
    // bỏ phần đã đọc để buffer không phình mãi
    if (this.offset > 64 * 1024) {
      this.buffer = this.buffer.slice(this.offset);
      this.offset = 0;
    }
    return out;
  }
}

export interface StreamCallbacks<T> {
  onChunk: (value: T, index: number) => void;
  onError?: (error: Error, raw: string) => void;
}

/**
 * Đọc response bằng fetch stream (cách hiện đại thay cho XHR readyState 3).
 * Tiền tố chỉ nằm ở đầu luồng nên chỉ kiểm tra một lần.
 */
export async function readJsonChunks<T = unknown>(
  response: Response,
  { onChunk, onError }: StreamCallbacks<T>,
  delimiter = '\r\n',
): Promise<number> {
  if (!response.body) throw new Error('response không có body để stream');
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  const parser = new ChunkParser(delimiter);
  let guardChecked = false;
  let head = '';
  let count = 0;

  const emit = (pieces: string[]) => {
    for (const raw of pieces) {
      try {
        onChunk(JSON.parse(raw) as T, count++);
      } catch (e) {
        onError?.(e as Error, raw);
      }
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!guardChecked) {
      head += value;
      if (head.length < GUARD.length) continue; // chưa đủ ký tự để kiểm tra tiền tố
      const body = stripGuard(head);
      if (body === null) {
        await reader.cancel();
        throw new Error('response thiếu tiền tố bảo vệ');
      }
      guardChecked = true;
      emit(parser.push(body));
      continue;
    }
    emit(parser.push(value));
  }
  if (!guardChecked) throw new Error('response kết thúc trước khi đủ tiền tố');
  emit(parser.end());
  return count;
}
