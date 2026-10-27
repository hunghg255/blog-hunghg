/**
 * Một ResizeObserver dùng chung cho mọi khối line-clamp (ý tưởng từ LineClamp.svelte của
 * App Store web): báo khối đang hiển thị mấy dòng và có bị cắt không, để đổi giao diện theo.
 */

export interface ClampState {
  /** cao hơn một dòng */
  multiline: boolean;
  /** số dòng đang hiển thị (làm tròn) */
  lineCount: number;
  /** nội dung dài hơn phần đang hiện (bị line-clamp cắt) */
  truncated: boolean;
}

type Listener = (state: ClampState) => void;

const listeners = new Map<Element, Listener>();
let observer: ResizeObserver | null = null;

function lineHeightOf(element: Element): number {
  const style = getComputedStyle(element);
  const lineHeight = parseFloat(style.lineHeight);
  // `line-height: normal` cho ra NaN; ước lượng ~1.2 lần cỡ chữ (giá trị "normal" phổ biến)
  return Number.isNaN(lineHeight) ? parseFloat(style.fontSize) * 1.2 : lineHeight;
}

function onResize(entries: ResizeObserverEntry[]) {
  for (const entry of entries) {
    const listener = listeners.get(entry.target);
    if (!listener) continue;
    const contentHeight = entry.contentRect.height;
    const borderBox = entry.borderBoxSize?.[0]?.blockSize ?? (entry.target as HTMLElement).offsetHeight;
    const lineHeight = lineHeightOf(entry.target);
    listener({
      multiline: contentHeight > lineHeight + 1,
      lineCount: Math.max(1, Math.round(contentHeight / lineHeight)),
      truncated: Math.ceil(entry.target.scrollHeight) > Math.ceil(borderBox),
    });
  }
}

/** Theo dõi một khối line-clamp. Trả về hàm huỷ. */
export function observeClamp(element: Element, listener: Listener): () => void {
  observer ??= new ResizeObserver(onResize);
  listeners.set(element, listener);
  observer.observe(element);
  return () => {
    listeners.delete(element);
    observer?.unobserve(element);
  };
}
