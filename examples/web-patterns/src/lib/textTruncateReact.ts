import { useLayoutEffect, useState, type RefObject } from 'react';
import { createCanvasMeasurer, truncateText, type TruncateResult } from './textTruncate';

export interface UseTruncatedTextOptions {
  lines: number;
  firstLineIndent?: number;
}

/**
 * Cắt `text` cho vừa element `ref` (đo bằng canvas), tính lại khi element đổi kích thước
 * và khi web font tải xong (đo bằng font dự phòng thì kết quả sai).
 */
export function useTruncatedText(
  ref: RefObject<HTMLElement | null>,
  text: string,
  { lines, firstLineIndent = 0 }: UseTruncatedTextOptions,
): TruncateResult & { measureCalls: number } {
  const [result, setResult] = useState<TruncateResult & { measureCalls: number }>({
    lines: [text],
    text,
    truncated: false,
    measureCalls: 0,
  });

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    let frame = 0;

    const update = () => {
      cancelAnimationFrame(frame);
      // gom nhiều lần resize trong cùng một frame thành một lần tính
      frame = requestAnimationFrame(() => {
        const style = getComputedStyle(element);
        // clientWidth gồm cả padding; chữ chỉ được nằm trong content box
        const width = element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
        if (width <= 0) return; // đang ẩn (display: none): giữ kết quả cũ
        // tạo measurer mới mỗi lần: font có thể vừa đổi (web font tải xong, media query)
        const measurer = createCanvasMeasurer(element);
        const next = truncateText(text, { maxWidth: width, lines, firstLineIndent, measure: measurer.measure });
        setResult({ ...next, measureCalls: measurer.calls });
      });
    };

    const observer = new ResizeObserver(update);
    observer.observe(element);
    let alive = true;
    document.fonts?.ready.then(() => alive && update());
    return () => {
      alive = false;
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [ref, text, lines, firstLineIndent]);

  return result;
}
