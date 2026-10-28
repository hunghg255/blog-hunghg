/**
 * Viết lại theo đúng hành vi của ChunkedRequest (KHÔNG phải mã của Facebook):
 * mỗi lần readyState 3/4, XHR đưa TOÀN BỘ responseText cho parser, parser nhớ offset.
 */
export class ChunkParserFbStyle {
  offset = 0;

  constructor(private readonly delimiter = '\r\n') {}

  /**
   * Nhánh `final` của parser: đẩy phần còn lại, kể cả khi rỗng. Trong bản gốc
   * người gọi KHÔNG BAO GIỜ truyền `final`, nên nhánh này là code chết.
   */
  parse(text: string, final = false): string[] {
    const out: string[] = [];
    const rest = text.substring(this.offset);
    let start = 0;
    let idx = rest.indexOf(this.delimiter, start);
    if (idx === 0) {
      start = this.delimiter.length;
      idx = rest.indexOf(this.delimiter, start);
    }
    while (idx > -1) {
      const piece = rest.substring(start, idx);
      if (piece) out.push(piece);
      start = idx + this.delimiter.length;
      idx = rest.indexOf(this.delimiter, start);
    }
    this.offset += start;
    if (final && rest && idx === -1) out.push(text.substring(this.offset));
    return out;
  }
}

/** Mẩu đánh dấu kết thúc mà ChunkedRequest phát ra ở readyState 4. */
export const END_MARKER = '{}';

/**
 * Hàm xử lý readystatechange của bản gốc: gọi `parse(text)` không có `final`, nên phần
 * sau dấu phân cách cuối cùng (mẩu cuối không có \r\n) không bao giờ được phát ra.
 */
export function onReadyStateFbStyle(parser: ChunkParserFbStyle, responseText: string, done: boolean): string[] {
  const chunks = parser.parse(responseText);
  return done ? [...chunks, END_MARKER] : chunks;
}
