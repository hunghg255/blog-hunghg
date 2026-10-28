/**
 * Xem trước link khi soạn tin: tìm URL đầu tiên (cân ngoặc ở cuối), gọi preview có debounce,
 * bỏ kết quả cũ, nhớ URL người dùng đã tắt. Viết lại từ ý tưởng của WhatsApp Web 2020
 * (module dbcedfihd: linkify, jhijifcjh: ô soạn tin).
 */

const PAIRS: Record<string, string> = { ')': '(', ']': '[', '}': '{', '>': '<', '»': '«', '’': '‘', '”': '“' };
const OPENERS = new Set(Object.values(PAIRS));

/** Bỏ ngoặc đóng/dấu câu thừa ở cuối: "(xem a.com/x_(y))." → "a.com/x_(y)". */
export function trimUrlTail(url: string): string {
  const stack: string[] = [];
  let safe = 0; // độ dài phần chắc chắn thuộc URL
  for (let i = 0; i < url.length; i++) {
    const ch = url[i];
    if (OPENERS.has(ch)) stack.push(ch);
    else if (ch in PAIRS) {
      if (stack[stack.length - 1] !== PAIRS[ch]) break; // ngoặc đóng không có cặp → hết URL
      stack.pop();
      if (!stack.length) safe = i + 1;
    } else if (!stack.length) safe = i + 1;
  }
  let out = url.slice(0, safe);
  while (/[.,:;!?'"]$/.test(out)) out = out.slice(0, -1);
  return out;
}

/** Tìm URL đầu tiên. "_" ngay trước chỉ được chấp nhận ở đầu chuỗi hoặc sau khoảng trắng (chữ nghiêng). */
export function findFirstUrl(text: string): string | null {
  const re = /(^|[\s(<"'«“_])((?:https?:\/\/)?(?:[\p{L}\p{N}-]+\.)+[a-z]{2,}(?::\d{1,5})?(?:[/?#][^\s]*)?)/giu;
  for (const m of text.matchAll(re)) {
    const lead = m[1];
    const at = m.index;
    if (lead === '_' && at > 0 && /\S/.test(text[at - 1])) continue; // bản gốc viết `c - 1 &&` nên sai ở vị trí 0
    let url = trimUrlTail(m[2]);
    if (lead === '_' && url.endsWith('_')) url = url.slice(0, -1);
    const port = /:(\d+)/.exec(url.replace(/^https?:\/\//, ''))?.[1];
    if (port && (port[0] === '0' || +port < 1 || +port > 65535)) continue;
    if (url) return url;
  }
  return null;
}

export interface Preview {
  url: string;
  title: string;
  description?: string;
}

export interface PreviewSchedulerOptions {
  fetchPreview: (url: string) => Promise<Preview | null>;
  onChange: (preview: Preview | null, state: 'idle' | 'loading') => void;
  typingDelay?: number;
}

export function createPreviewScheduler({ fetchPreview, onChange, typingDelay = 700 }: PreviewSchedulerOptions) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let wanted: string | null = null; // URL đang chờ kết quả
  let shown: string | null = null;
  let omitted: string | null = null; // người dùng đã bấm ✕ cho URL này

  function scan(text: string) {
    const url = findFirstUrl(text);
    if (url === wanted || url === shown) return;
    if (!url || url === omitted) {
      wanted = shown = null;
      onChange(null, 'idle');
      return;
    }
    wanted = url;
    onChange(null, 'loading');
    fetchPreview(url).then((p) => {
      if (wanted !== url) return; // đã gõ sang URL khác: bỏ kết quả cũ
      wanted = null;
      if (p && (p.title || p.description)) {
        shown = url;
        onChange(p, 'idle');
      } else onChange(null, 'idle');
    });
  }

  return {
    /** Gõ phím: đợi người dùng ngừng gõ. */
    onType(text: string) {
      clearTimeout(timer);
      timer = setTimeout(() => scan(text), typingDelay);
    },
    /** Dán: gần như ngay lập tức. */
    onPaste(text: string) {
      clearTimeout(timer);
      timer = setTimeout(() => scan(text), 1);
    },
    dismiss() {
      omitted = shown ?? wanted;
      wanted = shown = null;
      onChange(null, 'idle');
    },
    /** Gửi tin: huỷ mọi preview đang chờ. */
    cancel() {
      clearTimeout(timer);
      wanted = shown = omitted = null;
      onChange(null, 'idle');
    },
  };
}
