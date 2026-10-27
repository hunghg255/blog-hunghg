/**
 * Autocomplete (@mention, :emoji:) ngay tại con trỏ trong một ô contenteditable.
 * Ý tưởng từ SelectionUtil.js của Ello (lấy "từ đang gõ" quanh con trỏ bằng Selection + Range)
 * và các helper soạn thảo của Telegram Web (chèn vào selection, xoá đúng một ký tự).
 */

export interface CaretWord {
  /** ký tự kích hoạt: '@' hoặc ':' */
  trigger: string;
  /** phần gõ sau ký tự kích hoạt, vd "an" trong "@an" */
  query: string;
  /** Range bao đúng "@an", dùng để đo vị trí và để thay thế */
  range: Range;
}

const STOP = /\s/;

/**
 * Tìm "từ" kết thúc ngay tại con trỏ. Chỉ nhận khi:
 * - selection đang thu gọn (không bôi đen) và nằm trong `root`,
 * - từ bắt đầu bằng một trong các `triggers` và ký tự kích hoạt đứng đầu dòng hoặc sau khoảng trắng
 *   (để "a@b.com" không bật gợi ý mention).
 */
export function getWordAtCaret(root: HTMLElement, triggers = ['@', ':']): CaretWord | null {
  const selection = document.getSelection();
  if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) return null;
  const node = selection.anchorNode;
  if (!node || node.nodeType !== Node.TEXT_NODE || !root.contains(node)) return null;

  const text = node.textContent ?? '';
  const end = selection.anchorOffset; // vị trí con trỏ, tính theo UTF-16 code unit
  let start = end;
  // Lùi từng ký tự cho tới khoảng trắng. Ký tự dừng đều là ASCII nên lùi theo code unit vẫn an toàn
  // với emoji (cặp surrogate không bao giờ là khoảng trắng).
  while (start > 0 && !STOP.test(text[start - 1])) start--;

  const word = text.slice(start, end);
  const trigger = word[0];
  if (!trigger || !triggers.includes(trigger)) return null;
  const query = word.slice(1);
  // ":" kiểu emoji thì phải có ít nhất 2 ký tự, kẻo "10:30" hay "Lưu ý:" cũng bật gợi ý
  if (trigger === ':' && query.length < 2) return null;
  if (/[^\p{L}\p{N}_+-]/u.test(query)) return null;

  const range = document.createRange();
  range.setStart(node, start);
  range.setEnd(node, end);
  return { trigger, query, range };
}

/**
 * Toạ độ để đặt popup: lấy hình chữ nhật CUỐI của từ. Một từ bị ngắt dòng có 2 hình chữ nhật,
 * còn getBoundingClientRect() trả về khung bao cả hai dòng, popup sẽ lệch sang trái.
 */
export function getWordRect(range: Range): DOMRect | null {
  const rects = range.getClientRects();
  if (rects.length > 0) return rects[rects.length - 1];
  const rect = range.getBoundingClientRect();
  return rect.width || rect.height ? rect : null;
}

/** Đặt con trỏ thu gọn ngay sau `node`. */
function placeCaretAfter(node: Node) {
  const selection = document.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.setStartAfter(node);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

/** Báo cho framework (React, form state…) là nội dung đã đổi, vì sửa DOM bằng Range không phát `input`. */
function notifyInput(root: HTMLElement) {
  root.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertReplacementText' }));
}

/**
 * Thay "@an" bằng `replacement`, thêm một khoảng trắng không ngắt (NBSP) phía sau.
 * NBSP vì khoảng trắng thường ở cuối một contenteditable sẽ bị trình duyệt gộp mất.
 */
export function replaceCaretWord(root: HTMLElement, word: CaretWord, replacement: string) {
  const node = document.createTextNode(`${replacement}\u00a0`);
  word.range.deleteContents();
  word.range.insertNode(node);
  placeCaretAfter(node);
  root.normalize(); // gộp các text node liền kề để lần tìm từ sau không bị cắt ngang
  notifyInput(root);
}

/** Selection hiện tại có nằm trong `root` không (Telegram: isSelectionInsideInput). */
export function isSelectionInside(root: HTMLElement): boolean {
  const selection = document.getSelection();
  if (!selection || selection.rangeCount === 0) return false;
  return root.contains(selection.getRangeAt(0).commonAncestorContainer);
}

/**
 * Chèn chữ tại con trỏ. Nếu con trỏ không ở trong ô soạn thảo (người dùng vừa bấm vào bảng emoji…)
 * thì chèn vào cuối ô. Chỉ chèn TEXT node: chèn chuỗi HTML (như insertHtmlInSelection của Telegram)
 * với dữ liệu người dùng là mở cửa cho XSS.
 */
export function insertTextAtCaret(root: HTMLElement, text: string) {
  const node = document.createTextNode(text);
  if (isSelectionInside(root)) {
    const range = document.getSelection()!.getRangeAt(0);
    range.deleteContents();
    range.insertNode(node);
  } else {
    root.appendChild(node);
  }
  placeCaretAfter(node);
  root.normalize();
  notifyInput(root);
}

// ---- Xoá đúng MỘT ký tự người dùng nhìn thấy (grapheme) ----

const segmenter =
  typeof Intl !== 'undefined' && 'Segmenter' in Intl
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null;

/**
 * Bỏ grapheme cuối của chuỗi: "👨‍👩‍👧" (5 code point, 8 code unit) là MỘT grapheme.
 * Fallback khi không có Intl.Segmenter: bỏ một code point (đúng với emoji đơn, sai với chuỗi ZWJ).
 */
export function dropLastGrapheme(text: string): string {
  if (!text) return text;
  if (segmenter) {
    let lastIndex = 0;
    for (const { index } of segmenter.segment(text)) lastIndex = index;
    return text.slice(0, lastIndex);
  }
  const points = Array.from(text);
  points.pop();
  return points.join('');
}

/** Text node cuối cùng (sâu nhất) trong `root` mà còn chữ. */
function lastTextNode(root: Node): Text | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let last: Text | null = null;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if ((n.textContent ?? '').length > 0) last = n as Text;
  }
  return last;
}

/**
 * Nút ⌫ trên bảng emoji. Con trỏ còn trong ô soạn thảo thì xoá grapheme ngay trước con trỏ;
 * không thì (người dùng đã bấm ra ngoài) xoá grapheme cuối cùng của ô.
 * Telegram làm nhánh thứ hai bằng cách nhét HTML vào một contenteditable ẩn rồi gọi
 * execCommand('delete') để trình duyệt tự lo ranh giới ký tự. Ở đây dùng Intl.Segmenter.
 */
export function deleteGraphemeBeforeCaret(root: HTMLElement) {
  const selection = document.getSelection();
  const anchor = selection?.anchorNode;
  if (selection && selection.isCollapsed && anchor?.nodeType === Node.TEXT_NODE && root.contains(anchor)) {
    const text = anchor.textContent ?? '';
    const offset = selection.anchorOffset;
    if (offset > 0) {
      const before = dropLastGrapheme(text.slice(0, offset));
      anchor.textContent = before + text.slice(offset);
      const range = document.createRange();
      range.setStart(anchor, before.length);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
      notifyInput(root);
      return;
    }
  }
  const node = lastTextNode(root);
  if (!node) return;
  node.textContent = dropLastGrapheme(node.textContent ?? '');
  if (node.textContent === '') node.remove();
  notifyInput(root);
}
