/**
 * Cắt chữ nhiều dòng + dấu "…" bằng cách tự đo chữ với canvas.measureText
 * (ý tưởng từ TextTruncate trong lịch của Pipedrive).
 *
 * Dùng khi CSS line-clamp không đủ: cần chuỗi đã cắt (để làm title, tooltip, export),
 * dòng đầu ngắn hơn các dòng sau (chừa chỗ cho giờ/icon), hoặc cần biết có bị cắt hay không.
 */

export interface TextMeasurer {
  /** chiều rộng (px) của chuỗi khi vẽ bằng font của element */
  measure(text: string): number;
  /** số lần thực sự gọi measureText (không tính lần lấy từ cache) */
  readonly calls: number;
}

/** Ghép font shorthand từ computed style; Firefox có thể trả `font` rỗng nên tự ghép. */
export function fontFromStyle(style: CSSStyleDeclaration): string {
  if (style.font) return style.font;
  return [style.fontStyle, style.fontVariant, style.fontWeight, style.fontSize, style.fontFamily]
    .filter((part) => part && part !== 'normal')
    .join(' ');
}

/**
 * Tạo bộ đo chữ theo đúng font hiện tại của element. Canvas không cần gắn vào DOM.
 * Kết quả đo được cache theo chuỗi: vòng lặp cắt chữ đo lại cùng một chuỗi rất nhiều lần.
 */
export function createCanvasMeasurer(element: Element): TextMeasurer {
  const style = getComputedStyle(element);
  const context = document.createElement('canvas').getContext('2d');
  if (!context) throw new Error('Canvas 2D không khả dụng');
  context.font = fontFromStyle(style);
  // letter-spacing của CSS không tự áp lên canvas; trình duyệt nào có thuộc tính này thì set
  if ('letterSpacing' in context && style.letterSpacing !== 'normal') {
    (context as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = style.letterSpacing;
  }

  const cache = new Map<string, number>();
  let calls = 0;
  return {
    measure(text) {
      let width = cache.get(text);
      if (width === undefined) {
        calls++;
        width = context.measureText(text).width;
        cache.set(text, width);
      }
      return width;
    },
    get calls() {
      return calls;
    },
  };
}

/** Tách chuỗi thành các ký tự hiển thị (grapheme), để không cắt đôi emoji hay chữ có dấu tổ hợp. */
function graphemes(text: string): string[] {
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    return Array.from(segmenter.segment(text), (s) => s.segment);
  }
  return Array.from(text);
}

/** Tìm tiền tố dài nhất của `word` (theo grapheme) mà `measure(prefix + suffix) <= width`. */
function longestFittingPrefix(word: string, suffix: string, width: number, measure: (s: string) => number) {
  const chars = graphemes(word);
  let lo = 0;
  let hi = chars.length;
  // tìm nhị phân: O(log n) lần đo thay vì đo từng ký tự
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measure(chars.slice(0, mid).join('') + suffix) <= width) lo = mid;
    else hi = mid - 1;
  }
  return chars.slice(0, lo).join('');
}

export interface TruncateOptions {
  /** chiều rộng khả dụng của mỗi dòng (px) */
  maxWidth: number;
  /** số dòng tối đa */
  lines: number;
  measure: (text: string) => number;
  /** dòng đầu ngắn hơn bao nhiêu px (vd chừa chỗ cho giờ hẹn ở đầu dòng) */
  firstLineIndent?: number;
  ellipsis?: string;
}

export interface TruncateResult {
  /** nội dung từng dòng sau khi cắt (dòng cuối đã có ellipsis nếu bị cắt) */
  lines: string[];
  /** toàn bộ chuỗi sau khi cắt */
  text: string;
  truncated: boolean;
}

/**
 * Xếp chữ vào tối đa `lines` dòng, ngắt theo từ, dòng cuối thêm "…" nếu còn thừa.
 * Từ dài hơn cả dòng thì cắt theo ký tự (tìm nhị phân).
 */
export function truncateText(
  text: string,
  { maxWidth, lines, measure, firstLineIndent = 0, ellipsis = '…' }: TruncateOptions,
): TruncateResult {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let index = 0;

  for (let line = 0; line < lines && index < words.length; line++) {
    const width = Math.max(0, line === 0 ? maxWidth - firstLineIndent : maxWidth);
    const isLast = line === lines - 1;

    if (isLast) {
      const rest = words.slice(index).join(' ');
      if (measure(rest) <= width) {
        out.push(rest);
        index = words.length;
        break;
      }
      // không vừa: lấy nhiều từ nhất có thể sao cho còn chỗ cho "…"
      let current = '';
      while (index < words.length) {
        const candidate = current ? `${current} ${words[index]}` : words[index];
        if (measure(candidate + ellipsis) > width) break;
        current = candidate;
        index++;
      }
      if (!current) current = longestFittingPrefix(words[index], ellipsis, width, measure);
      out.push(current + ellipsis);
      return { lines: out, text: out.join(' '), truncated: true };
    }

    let current = '';
    while (index < words.length) {
      const candidate = current ? `${current} ${words[index]}` : words[index];
      if (measure(candidate) > width) break;
      current = candidate;
      index++;
    }
    if (!current) {
      // một từ dài hơn cả dòng: cắt theo ký tự, phần còn lại sang dòng sau
      const head = longestFittingPrefix(words[index], '', width, measure) || graphemes(words[index])[0];
      words[index] = words[index].slice(head.length);
      if (!words[index]) index++;
      current = head;
    }
    out.push(current);
  }

  const truncated = index < words.length;
  return { lines: out, text: out.join(' '), truncated };
}
