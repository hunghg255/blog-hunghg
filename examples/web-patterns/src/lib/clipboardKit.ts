/**
 * Bộ mẹo clipboard gom từ Trello, Anchor, Pipedrive và Tribe:
 * - copyText: Async Clipboard API, rơi về textarea ẩn + execCommand (kiểu Anchor, có xử lý iOS).
 * - installObjectClipboard: Ctrl/Cmd+C/X trên một "đối tượng" (thẻ, dòng…) mà không cần bôi đen chữ (kiểu Trello).
 * - pastePlainText: dán chữ thuần vào contenteditable mà vẫn giữ undo (kiểu Pipedrive).
 * - allowlistFromToolbar + sanitizeHtml: chỉ giữ thẻ mà editor hiển thị được (ý tưởng của Tribe / quill-paste-smart).
 */

// ---------- 1. Copy chữ ----------

export type CopyMethod = 'async-api' | 'exec-command' | 'failed';

/**
 * Copy bằng textarea tạm. Dùng khi không có navigator.clipboard (trang http, WebView cũ)
 * hoặc khi lời gọi không còn nằm trong "user activation" (Safari khắt khe chuyện này).
 */
export function legacyCopy(text: string): boolean {
  const previousFocus = document.activeElement as HTMLElement | null;
  const selection = document.getSelection();
  const previousRange = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;

  const textarea = document.createElement('textarea');
  textarea.value = text;
  // readonly: không bật bàn phím ảo trên mobile
  textarea.setAttribute('readonly', '');
  Object.assign(textarea.style, {
    position: 'fixed',
    top: '0',
    left: '0',
    width: '2em',
    height: '2em',
    padding: '0',
    border: 'none',
    outline: 'none',
    boxShadow: 'none',
    background: 'transparent',
    opacity: '0',
    // < 16px thì iOS Safari tự zoom khi focus vào ô nhập
    fontSize: '16px',
  });
  document.body.appendChild(textarea);

  // iOS cũ: select() không chọn được chữ trong textarea, phải tạo Range rồi setSelectionRange
  const range = document.createRange();
  range.selectNodeContents(textarea);
  selection?.removeAllRanges();
  selection?.addRange(range);
  textarea.select();
  textarea.setSelectionRange(0, text.length);

  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  textarea.remove();

  // trả lại vùng chọn và focus cũ (bản của Anchor bỏ qua bước này)
  selection?.removeAllRanges();
  if (previousRange) selection?.addRange(previousRange);
  previousFocus?.focus?.({ preventScroll: true });
  return ok;
}

export async function copyText(text: string, { preferLegacy = false } = {}): Promise<CopyMethod> {
  if (!preferLegacy && navigator.clipboard?.writeText && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return 'async-api';
    } catch {
      // bị chặn (thiếu quyền, iframe không có allow="clipboard-write"…): thử cách cũ
    }
  }
  return legacyCopy(text) ? 'exec-command' : 'failed';
}

// ---------- 2. Clipboard cho "đối tượng" (Trello) ----------

export interface ObjectClipboardOptions {
  /** chuỗi sẽ vào clipboard khi bấm Ctrl/Cmd+C, vd URL của thẻ đang chọn; null = không có gì để copy */
  getValue: () => string | null;
  onCopy?: (value: string) => void;
  onCut?: (value: string) => void;
  /** người dùng dán ảnh trong lúc đang giữ phím tắt (Ctrl+V vào vùng ẩn) */
  onPasteImage?: (file: File) => void;
  /** nơi gắn vùng ẩn, mặc định document.body */
  root?: HTMLElement;
}

const isTypingTarget = (el: EventTarget | null) =>
  el instanceof HTMLElement &&
  (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));

/**
 * Ý tưởng của Trello: ngay khi người dùng nhấn Ctrl/Cmd (chưa kịp nhấn C), tạo một
 * contenteditable ẩn chứa giá trị, focus và bôi đen nó. Phím C tới sau rơi vào vùng đó,
 * trình duyệt tự làm phần copy thật. Ctrl+X làm vùng đó rỗng: đó là "cut".
 */
export function installObjectClipboard(options: ObjectClipboardOptions) {
  const { getValue, onCopy, onCut, onPasteImage, root = document.body } = options;
  let holder: HTMLDivElement | null = null;
  let value = '';
  let cutReported = false;
  let returnFocusTo: HTMLElement | null = null;

  const teardown = () => {
    if (!holder) return;
    const hadFocus = holder.contains(document.activeElement);
    holder.remove();
    holder = null;
    // Trello để focus rơi về <body>; trả về chỗ cũ để người dùng bàn phím không mất vị trí
    if (hadFocus) returnFocusTo?.focus({ preventScroll: true });
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (!(event.ctrlKey || event.metaKey)) return;
    if (holder && event.target === holder) {
      if (event.key.toLowerCase() === 'c') onCopy?.(value);
      return;
    }
    if (holder) return;
    if (isTypingTarget(event.target)) return;
    // đang bôi đen một đoạn chữ: để người dùng copy đoạn đó như bình thường
    if (document.getSelection()?.toString()) return;
    const next = getValue();
    if (!next) return;

    value = next;
    cutReported = false;
    returnFocusTo = document.activeElement as HTMLElement | null;
    holder = document.createElement('div');
    holder.contentEditable = 'true';
    holder.setAttribute('aria-hidden', 'true');
    holder.dataset.objectClipboard = '';
    Object.assign(holder.style, { position: 'fixed', left: '-9999px', top: '0', opacity: '0' });
    holder.textContent = value;
    root.appendChild(holder);
    holder.focus({ preventScroll: true });
    const range = document.createRange();
    range.selectNodeContents(holder);
    const selection = document.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  };

  const onKeyUp = (event: KeyboardEvent) => {
    if (!holder) return;
    // Ctrl+X đã xoá chữ trong vùng ẩn. Chỉ báo một lần: nhả X rồi nhả Ctrl là hai lần keyup.
    if (holder.textContent === '' && !cutReported) {
      cutReported = true;
      onCut?.(value);
    }
    // nhả hết phím bổ trợ thì dọn; còn giữ Ctrl thì để người dùng bấm tiếp (Ctrl+C rồi Ctrl+V)
    if (!event.ctrlKey && !event.metaKey) teardown();
  };

  const onPaste = (event: ClipboardEvent) => {
    if (!holder || event.target !== holder) return;
    // Trello đợi ảnh hiện ra trong vùng ẩn rồi đọc data: URI (Firefox cũ). Ngày nay clipboardData.files là đủ.
    const file = Array.from(event.clipboardData?.files ?? []).find((f) => f.type.startsWith('image/'));
    event.preventDefault();
    if (file) onPasteImage?.(file);
  };

  const onBlur = () => teardown();

  document.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('keyup', onKeyUp, true);
  document.addEventListener('paste', onPaste, true);
  window.addEventListener('blur', onBlur);
  return () => {
    teardown();
    document.removeEventListener('keydown', onKeyDown, true);
    document.removeEventListener('keyup', onKeyUp, true);
    document.removeEventListener('paste', onPaste, true);
    window.removeEventListener('blur', onBlur);
  };
}

/**
 * Trello lưu "đang cut cái gì" vào localStorage: dán ở tab khác cũng biết là chuyển (move) chứ không phải nhân bản.
 * Sau khi dán 1 giây thì xoá dấu cut.
 */
export const cutMarker = {
  key: 'object-clipboard:cut',
  set(value: string) {
    try {
      localStorage.setItem(this.key, value);
    } catch {
      /* chế độ riêng tư / storage đầy: coi như copy */
    }
  },
  isCut(value: string) {
    try {
      return localStorage.getItem(this.key) === value;
    } catch {
      return false;
    }
  },
  clear() {
    try {
      localStorage.removeItem(this.key);
    } catch {
      /* bỏ qua */
    }
  },
};

// ---------- 3. Dán chữ thuần (Pipedrive) ----------

/** Ô một dòng: xuống dòng thành dấu cách, NBSP (U+00A0) thành dấu cách thường. */
export function normalizeSingleLine(text: string): string {
  return text.replace(/\r\n?|\n/g, ' ').replace(/\u00a0/g, ' ');
}

/**
 * Gắn vào onPaste của một contenteditable. execCommand('insertText') đã bị đánh dấu deprecated
 * nhưng vẫn là cách duy nhất để thao tác dán nằm trong lịch sử undo (Ctrl+Z) của trình duyệt.
 */
export function pastePlainText(event: ClipboardEvent, transform: (text: string) => string = (t) => t): string {
  event.preventDefault();
  const text = transform(event.clipboardData?.getData('text/plain') ?? '');
  const inserted = document.queryCommandSupported?.('insertText') && document.execCommand('insertText', false, text);
  if (!inserted) {
    const selection = document.getSelection();
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      range.deleteContents();
      const node = document.createTextNode(text);
      range.insertNode(node);
      range.setStartAfter(node);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
    }
  }
  return text;
}

// ---------- 4. Dán HTML có kiểm soát (Tribe) ----------

export type ToolbarFeature = 'bold' | 'italic' | 'underline' | 'strike' | 'link' | 'list' | 'header' | 'blockquote' | 'code-block' | 'image';

export interface Allowlist {
  tags: Set<string>;
  attributes: Set<string>;
}

const FEATURE_TAGS: Record<ToolbarFeature, { tags: string[]; attributes?: string[] }> = {
  bold: { tags: ['b', 'strong'] },
  italic: { tags: ['i', 'em'] },
  underline: { tags: ['u'] },
  strike: { tags: ['s'] },
  link: { tags: ['a'], attributes: ['href'] },
  list: { tags: ['ul', 'ol', 'li'] },
  header: { tags: ['h2', 'h3'] },
  blockquote: { tags: ['blockquote'] },
  'code-block': { tags: ['pre'] },
  image: { tags: ['img'], attributes: ['src', 'alt'] },
};

/** Thanh công cụ có nút nào thì mới cho thẻ tương ứng đi qua. Không có nút "link" thì dán vào cũng không có link. */
export function allowlistFromToolbar(features: ToolbarFeature[]): Allowlist {
  const tags = new Set(['p', 'br']);
  const attributes = new Set<string>();
  for (const feature of features) {
    FEATURE_TAGS[feature].tags.forEach((t) => tags.add(t));
    FEATURE_TAGS[feature].attributes?.forEach((a) => attributes.add(a));
  }
  return { tags, attributes };
}

// bỏ cả nội dung bên trong, không chỉ thẻ
const DROP_WITH_CONTENT = new Set(['script', 'style', 'template', 'noscript', 'iframe', 'object', 'embed', 'svg', 'math', 'head', 'title', 'meta', 'link']);
const SAFE_URL = /^(https?:|mailto:|tel:|#|\/(?!\/))/i;

/**
 * Google Docs, Word… không dùng <b>/<i> mà dùng <span style="font-weight:700">. Docs còn bọc cả
 * đoạn dán trong <b style="font-weight:normal">: lọc theo tên thẻ thì cả đoạn thành chữ đậm.
 * Đổi tên thẻ theo style thật trước khi so với allowlist.
 */
function styledTag(el: Element, tag: string, allow: Allowlist): string {
  const style = (el as HTMLElement).style;
  if (!style) return tag;
  const keyword: Record<string, number> = { normal: 400, bold: 700, bolder: 700, lighter: 300 };
  const weight = keyword[style.fontWeight] ?? Number(style.fontWeight || NaN);
  if ((tag === 'b' || tag === 'strong') && weight < 600) return 'span';
  if (tag !== 'span') return tag;
  if (weight >= 600 && allow.tags.has('strong')) return 'strong';
  if (style.fontStyle === 'italic' && allow.tags.has('em')) return 'em';
  if (style.textDecorationLine?.includes('underline') && allow.tags.has('u')) return 'u';
  return tag;
}

/**
 * Bộ lọc theo allowlist, dựng bằng DOMParser (tài liệu "trơ": script không chạy, ảnh không tải).
 * Đủ cho demo; production nên dùng DOMPurify hoặc Sanitizer API (`setHTML`) khi trình duyệt hỗ trợ.
 */
export function sanitizeHtml(html: string, allow: Allowlist): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const out = document.createElement('div');

  const walk = (from: Node, to: Node) => {
    from.childNodes.forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) {
        to.appendChild(document.createTextNode(child.textContent ?? ''));
        return;
      }
      if (!(child instanceof Element)) return; // comment, processing instruction…
      let tag = child.tagName.toLowerCase();
      if (DROP_WITH_CONTENT.has(tag)) return;
      tag = styledTag(child, tag, allow);
      if (!allow.tags.has(tag)) {
        // thẻ lạ (span, div, font…): bỏ thẻ, giữ chữ bên trong
        walk(child, to);
        if (/^(div|p|li|h\d|tr)$/.test(tag)) to.appendChild(document.createElement('br'));
        return;
      }
      const clean = document.createElement(tag);
      for (const attr of Array.from(child.attributes)) {
        const name = attr.name.toLowerCase();
        if (!allow.attributes.has(name)) continue;
        if ((name === 'href' || name === 'src') && !SAFE_URL.test(attr.value.trim())) continue;
        clean.setAttribute(name, attr.value);
      }
      if (tag === 'a') {
        // href bị loại (javascript:…) thì thẻ <a> không còn ý nghĩa: giữ chữ, bỏ thẻ
        if (!clean.hasAttribute('href')) {
          walk(child, to);
          return;
        }
        clean.setAttribute('rel', 'noopener noreferrer');
      }
      walk(child, clean);
      to.appendChild(clean);
    });
  };

  walk(doc.body, out);
  return out.innerHTML;
}

/** Chỉ nhận URL tuyệt đối http(s) không có khoảng trắng: đủ để quyết định "dán link". */
export function isHttpUrl(text: string): boolean {
  if (/\s/.test(text.trim())) return false;
  try {
    const url = new URL(text.trim());
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export type SmartPasteResult =
  | { kind: 'link-on-selection'; url: string; text: string }
  | { kind: 'embed'; url: string }
  | { kind: 'html'; html: string }
  | { kind: 'text'; text: string };

/**
 * Quyết định dán thế nào (logic của Tribe, tách khỏi Quill):
 * dán URL khi đang bôi đen chữ -> biến chữ đó thành link; dán URL trần -> đề nghị embed;
 * có HTML -> lọc theo allowlist; còn lại -> chữ thuần.
 */
export function decideSmartPaste(data: { text: string; html: string }, selectedText: string, allow: Allowlist): SmartPasteResult {
  const text = data.text.trim();
  if (allow.tags.has('a') && isHttpUrl(text)) {
    return selectedText ? { kind: 'link-on-selection', url: text, text: selectedText } : { kind: 'embed', url: text };
  }
  if (data.html) return { kind: 'html', html: sanitizeHtml(data.html, allow) };
  return { kind: 'text', text: data.text };
}
