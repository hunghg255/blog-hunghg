/**
 * Rich text ⇄ { text, entities } kiểu Telegram (Telegram #15).
 *
 * Tin nhắn Telegram không lưu HTML. Server nhận chữ thuần + danh sách entity
 * `{ type, offset, length }` (offset tính theo UTF-16, giống String.length của JS).
 * Ô soạn tin là contenteditable nên phải đổi qua lại hai chiều:
 *   HTML của editor  → parse → { text, entities } → gửi / lưu nháp
 *   { text, entities } → render → HTML để hiện trong bong bóng hoặc khôi phục nháp
 */

export type EntityType = 'bold' | 'italic' | 'underline' | 'strike' | 'code' | 'pre' | 'link';

export interface MessageEntity {
  type: EntityType;
  offset: number;
  length: number;
  url?: string;
}

export interface FormattedText {
  text: string;
  entities: MessageEntity[];
}

export const MAX_MESSAGE_LENGTH = 4096;

const TYPE_BY_TAG: Record<string, EntityType> = {
  B: 'bold',
  STRONG: 'bold',
  I: 'italic',
  EM: 'italic',
  U: 'underline',
  S: 'strike',
  STRIKE: 'strike',
  DEL: 'strike',
  CODE: 'code',
  PRE: 'pre',
  A: 'link',
};

// ---------- Markdown nhanh: gõ **đậm**, __nghiêng__, ~~gạch~~, `code` ----------

/** Regex của bản gốc: nhánh `__` chép từ nhánh `**` nên vẫn loại trừ `*` thay vì `_`. */
export const ORIGINAL_ITALIC_RE = /[_]{2}([^*\n]+)[_]{2}/g;
/** Đã sửa: bên trong không được chứa `_`, nên không nuốt từ cặp `__` này sang cặp sau. */
export const FIXED_ITALIC_RE = /_{2}([^_\n]+)_{2}/g;

export function applyQuickMarkdown(text: string, italicRe: RegExp = FIXED_ITALIC_RE): string {
  return text
    .replace(/`{3}([^`]+)`{3}/g, '<pre>$1</pre>')
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*{2}([^*\n]+)\*{2}/g, '<b>$1</b>')
    .replace(italicRe, '<i>$1</i>')
    .replace(/~{2}([^~\n]+)~{2}/g, '<s>$1</s>');
}

// ---------- HTML → { text, entities } ----------

/**
 * Duyệt cây DOM và tính offset bằng một con trỏ chạy theo từng text node.
 * Bản gốc lấy `innerText` trước rồi tìm lại vị trí bằng `indexOf(node.textContent)`,
 * dễ gán nhầm khi cùng một đoạn chữ lặp lại; ở đây offset luôn đúng vì đếm trực tiếp.
 */
export function parseEditorHtml(root: HTMLElement): FormattedText {
  let text = '';
  const entities: MessageEntity[] = [];

  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      // &nbsp; của contenteditable thành dấu cách thường; bỏ zero-width space
      text += (node.textContent ?? '').replace(/ /g, ' ').replace(/​/g, '');
      return;
    }
    if (!(node instanceof HTMLElement)) return;

    if (node.tagName === 'BR') {
      text += '\n';
      return;
    }

    // Chrome bọc mỗi dòng mới trong <div>; Safari dùng <div><br></div> cho dòng trống
    const isBlock = node.tagName === 'DIV' || node.tagName === 'P';
    if (isBlock && text.length > 0 && !text.endsWith('\n')) text += '\n';

    const type = TYPE_BY_TAG[node.tagName];
    const start = text.length;
    node.childNodes.forEach(walk);
    const length = text.length - start;

    if (type && length > 0) {
      const entity: MessageEntity = { type, offset: start, length };
      if (type === 'link') entity.url = (node as HTMLAnchorElement).href;
      entities.push(entity);
    }
  };

  root.childNodes.forEach(walk);
  return trimFormattedText({ text, entities });
}

/** Cắt khoảng trắng hai đầu và giới hạn 4096 ký tự, dời offset của entity theo. */
export function trimFormattedText({ text, entities }: FormattedText): FormattedText {
  const lead = text.length - text.trimStart().length;
  const trimmed = text.trim().slice(0, MAX_MESSAGE_LENGTH);
  const result: MessageEntity[] = [];
  for (const entity of entities) {
    const start = Math.max(0, entity.offset - lead);
    const end = Math.min(trimmed.length, entity.offset + entity.length - lead);
    if (end > start) result.push({ ...entity, offset: start, length: end - start });
  }
  result.sort((a, b) => a.offset - b.offset || b.length - a.length);
  return { text: trimmed, entities: result };
}

// ---------- { text, entities } → HTML ----------

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const OPEN: Record<EntityType, (e: MessageEntity) => string> = {
  bold: () => '<b>',
  italic: () => '<i>',
  underline: () => '<u>',
  strike: () => '<s>',
  code: () => '<code>',
  pre: () => '<pre>',
  link: (e) => `<a href="${escapeHtml(safeUrl(e.url))}" target="_blank" rel="noopener noreferrer">`,
};
const CLOSE: Record<EntityType, string> = {
  bold: '</b>',
  italic: '</i>',
  underline: '</u>',
  strike: '</s>',
  code: '</code>',
  pre: '</pre>',
  link: '</a>',
};

function safeUrl(url = '') {
  try {
    const { protocol } = new URL(url, 'https://example.invalid');
    return protocol === 'http:' || protocol === 'https:' || protocol === 'mailto:' || protocol === 'tel:'
      ? url
      : '#';
  } catch {
    return '#';
  }
}

/**
 * Cắt chữ thành các đoạn tại MỌI điểm đầu/cuối entity, mỗi đoạn biết những entity nào phủ nó.
 * Cách này chịu được entity chồng lệch (đậm 0–5, nghiêng 3–8), thứ mà cây lồng nhau của
 * bản gốc (organizeEntities) giả định là không có.
 */
export function toSegments({ text, entities }: FormattedText) {
  const cuts = new Set([0, text.length]);
  for (const e of entities) {
    cuts.add(Math.max(0, Math.min(text.length, e.offset)));
    cuts.add(Math.max(0, Math.min(text.length, e.offset + e.length)));
  }
  const points = [...cuts].sort((a, b) => a - b);
  const segments: { text: string; entities: MessageEntity[] }[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const [from, to] = [points[i], points[i + 1]];
    segments.push({
      text: text.slice(from, to),
      entities: entities.filter((e) => e.offset <= from && e.offset + e.length >= to),
    });
  }
  return segments;
}

export function renderFormattedHtml(formatted: FormattedText): string {
  return toSegments(formatted)
    .map(({ text, entities }) => {
      const body = escapeHtml(text).replace(/\n/g, '<br>');
      // entity dài hơn bọc ngoài, để <a> không bị cắt vụn khi có đậm bên trong
      const sorted = [...entities].sort((a, b) => b.length - a.length);
      return sorted.map((e) => OPEN[e.type](e)).join('') + body + sorted.map((e) => CLOSE[e.type]).reverse().join('');
    })
    .join('');
}

// ---------- Thanh định dạng nổi ----------

export const TOOLBAR_SAFE_AREA = 90;

/** Vị trí x (tâm thanh công cụ) tính theo khung ô nhập, kẹp trong [90, width − 90]. */
export function getToolbarAnchor(selection: DOMRect, input: DOMRect, safeArea = TOOLBAR_SAFE_AREA) {
  const center = selection.left + selection.width / 2 - input.left;
  const x = Math.min(Math.max(center, safeArea), input.width - safeArea);
  return { x, y: selection.top - input.top };
}

/** Vùng chọn có nằm trong ô nhập không (bản gốc chỉ đi ngược tối đa 5 cha). */
export function isSelectionInside(range: Range, input: HTMLElement) {
  return input.contains(range.commonAncestorContainer);
}

// ---------- Nháp theo chat ----------

export interface DraftStore {
  /** gọi mỗi lần nội dung ô nhập đổi (đã debounce bên trong) */
  change(chatId: string, draft: FormattedText): void;
  /** gọi khi rời chat, ẩn tab, đóng trang: lưu ngay, không chờ debounce */
  flush(chatId: string, draft: FormattedText): void;
  get(chatId: string): FormattedText | undefined;
  setActiveChat(chatId: string): void;
  dispose(): void;
}

/**
 * Debounce lưu nháp mà không bao giờ ghi nhầm chat: callback nhớ chat lúc được hẹn
 * và tự bỏ nếu người dùng đã chuyển chat (giống biến `currentChatId` cấp module của bản gốc).
 */
export function createDraftStore(
  save: (chatId: string, draft: FormattedText | undefined) => void,
  debounceMs = 5000,
): DraftStore {
  const drafts = new Map<string, FormattedText>();
  let activeChat: string | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const write = (chatId: string, draft: FormattedText) => {
    if (draft.text.length === 0) {
      drafts.delete(chatId);
      save(chatId, undefined);
    } else {
      drafts.set(chatId, draft);
      save(chatId, draft);
    }
  };

  return {
    change(chatId, draft) {
      clearTimeout(timer);
      // xoá trắng thì xoá nháp ngay, không đợi
      if (draft.text.length === 0) {
        write(chatId, draft);
        return;
      }
      timer = setTimeout(() => {
        if (chatId !== activeChat) return; // chat đã đổi trong lúc chờ
        write(chatId, draft);
      }, debounceMs);
    },
    flush(chatId, draft) {
      clearTimeout(timer);
      write(chatId, draft);
    },
    get: (chatId) => drafts.get(chatId),
    setActiveChat(chatId) {
      activeChat = chatId;
    },
    dispose() {
      clearTimeout(timer);
    },
  };
}
