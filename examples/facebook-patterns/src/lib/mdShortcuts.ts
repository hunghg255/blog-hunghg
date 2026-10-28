/**
 * Phím tắt Markdown trong editor dạng block: gõ "# " thành tiêu đề, "- " thành danh sách...
 * Backspace ngay sau đó để hoàn tác. Kèm bộ chuyển Markdown nhiều dòng khi dán.
 * Ý tưởng học từ RichTextEditorMarkdownUtil (Draft.js) của Facebook, viết lại từ đầu,
 * không phụ thuộc Draft.js.
 */

export type BlockType =
  | 'unstyled'
  | 'header-one'
  | 'header-two'
  | 'blockquote'
  | 'code-block'
  | 'unordered-list-item'
  | 'ordered-list-item'
  | 'checkbox-list-item';

export interface Block {
  key: string;
  type: BlockType;
  text: string;
  depth: number;
  checked?: boolean;
}

export interface Shortcut {
  prefix: string;
  type: BlockType;
  checked?: boolean;
  /** bắt đầu danh sách: gõ lại trong danh sách cùng loại thì thụt vào một mức */
  list?: boolean;
  /** ``` bật/tắt khối code nhiều dòng khi dán */
  fence?: boolean;
}

export const SHORTCUTS: readonly Shortcut[] = [
  { prefix: '# ', type: 'header-one' },
  { prefix: '## ', type: 'header-two' },
  { prefix: '> ', type: 'blockquote' },
  { prefix: '```', type: 'code-block', fence: true },
  { prefix: '    ', type: 'code-block' },
  { prefix: '[] ', type: 'checkbox-list-item', checked: false },
  { prefix: '[ ] ', type: 'checkbox-list-item', checked: false },
  { prefix: '[x] ', type: 'checkbox-list-item', checked: true },
  { prefix: '[X] ', type: 'checkbox-list-item', checked: true },
  { prefix: '* ', type: 'unordered-list-item', list: true },
  { prefix: '- ', type: 'unordered-list-item', list: true },
  { prefix: '+ ', type: 'unordered-list-item', list: true },
  { prefix: '1. ', type: 'ordered-list-item', list: true },
  { prefix: '1) ', type: 'ordered-list-item', list: true },
];

/** tiền tố dài nhất; caret xa hơn thì khỏi kiểm tra */
const MAX_PREFIX = Math.max(...SHORTCUTS.map((s) => s.prefix.length));
export const MAX_DEPTH = 4;
const LISTS: BlockType[] = ['unordered-list-item', 'ordered-list-item', 'checkbox-list-item'];
export const isList = (t: BlockType) => LISTS.includes(t);

let seq = 0;
export const newKey = () => `b${++seq}`;
export const block = (text = '', type: BlockType = 'unstyled', depth = 0, checked?: boolean): Block => ({
  key: newKey(),
  type,
  text,
  depth,
  ...(type === 'checkbox-list-item' ? { checked: !!checked } : {}),
});

// ---------------------------------------------------------------- editor

export type LastChange = 'insert' | 'markdown' | 'other';

export interface Editor {
  blocks: Block[];
  caret: { key: string; offset: number };
  last: LastChange;
  /** trạng thái ngay trước lần đổi kiểu block gần nhất, để Backspace hoàn tác */
  undo: { before: Block; offset: number } | null;
}

export function createEditor(blocks: Block[] = [block()]): Editor {
  return { blocks, caret: { key: blocks[0].key, offset: 0 }, last: 'other', undo: null };
}

const indexOf = (ed: Editor, key: string) => ed.blocks.findIndex((b) => b.key === key);
const replaceAt = (blocks: Block[], i: number, ...items: Block[]) => [
  ...blocks.slice(0, i),
  ...items,
  ...blocks.slice(i + 1),
];

/** Tiền tố nào khớp với block tại vị trí caret, hoặc null. */
export function matchShortcut(b: Block, offset: number, shortcuts = SHORTCUTS): Shortcut | null {
  if (offset > MAX_PREFIX) return null;
  for (const s of shortcuts) {
    if (offset !== s.prefix.length || !b.text.startsWith(s.prefix)) continue;
    if (b.type === 'unstyled') return s;
    if (s.list && s.type === b.type) return s; // "- " trong danh sách gạch đầu dòng: thụt vào
  }
  return null;
}

/**
 * Người dùng sửa chữ trong một block. `inserted` = lần sửa này là gõ thêm ký tự
 * (InputEvent.inputType === 'insertText'); dán, xoá, IME thì không đổi kiểu block.
 */
export function editText(ed: Editor, key: string, text: string, offset: number, inserted: boolean): Editor {
  const i = indexOf(ed, key);
  const b = { ...ed.blocks[i], text };
  const s = inserted ? matchShortcut(b, offset) : null;
  if (!s) {
    return { blocks: replaceAt(ed.blocks, i, b), caret: { key, offset }, last: inserted ? 'insert' : 'other', undo: ed.undo };
  }
  const nested = b.type === s.type;
  const styled: Block = {
    ...b,
    type: s.type,
    text: text.slice(s.prefix.length),
    depth: nested ? Math.min(MAX_DEPTH, b.depth + 1) : b.depth,
    ...(s.type === 'checkbox-list-item' ? { checked: !!s.checked } : {}),
  };
  return {
    blocks: replaceAt(ed.blocks, i, styled),
    caret: { key, offset: 0 },
    last: 'markdown',
    undo: { before: b, offset },
  };
}

/**
 * Backspace khi caret ở đầu block. Trả null nếu để trình duyệt tự xử lý
 * (caret không ở đầu, hoặc là block đầu tiên không có kiểu).
 */
export function backspaceAtStart(ed: Editor): Editor | null {
  const { key, offset } = ed.caret;
  if (offset !== 0) return null;
  const i = indexOf(ed, key);
  const b = ed.blocks[i];
  // 1. vừa đổi kiểu bằng tiền tố: trả lại đúng chữ đã gõ
  if (ed.last === 'markdown' && ed.undo?.before.key === key) {
    return {
      blocks: replaceAt(ed.blocks, i, ed.undo.before),
      caret: { key, offset: ed.undo.offset },
      last: 'other',
      undo: null,
    };
  }
  // 2. block có kiểu: bỏ một mức thụt, rồi bỏ kiểu
  if (b.type !== 'unstyled') {
    const next: Block =
      isList(b.type) && b.depth > 0 ? { ...b, depth: b.depth - 1 } : { key: b.key, type: 'unstyled', text: b.text, depth: 0 };
    return { blocks: replaceAt(ed.blocks, i, next), caret: { key, offset: 0 }, last: 'other', undo: null };
  }
  // 3. block thường: nối vào block trước
  if (i === 0) return null;
  const prev = ed.blocks[i - 1];
  const merged = { ...prev, text: prev.text + b.text };
  return {
    blocks: [...ed.blocks.slice(0, i - 1), merged, ...ed.blocks.slice(i + 1)],
    caret: { key: prev.key, offset: prev.text.length },
    last: 'other',
    undo: null,
  };
}

/** Enter: tách block. Mục danh sách rỗng thì thoát danh sách thay vì tạo mục mới. */
export function splitBlock(ed: Editor): Editor {
  const { key, offset } = ed.caret;
  const i = indexOf(ed, key);
  const b = ed.blocks[i];
  if (b.text === '' && b.type !== 'unstyled') {
    const plain: Block = { key: b.key, type: 'unstyled', text: '', depth: 0 };
    return { blocks: replaceAt(ed.blocks, i, plain), caret: { key, offset: 0 }, last: 'other', undo: null };
  }
  const keepType = isList(b.type) || b.type === 'code-block';
  const tail = block(b.text.slice(offset), keepType ? b.type : 'unstyled', keepType ? b.depth : 0, false);
  return {
    blocks: replaceAt(ed.blocks, i, { ...b, text: b.text.slice(0, offset) }, tail),
    caret: { key: tail.key, offset: 0 },
    last: 'other',
    undo: null,
  };
}

// ---------------------------------------------------------------- dán Markdown

export interface PasteOptions {
  /**
   * Bản gốc: "2019. Một năm" luôn thành danh sách số và mất chữ "2019".
   * Mặc định ở đây theo CommonMark: danh sách số chỉ được ngắt đoạn văn khi bắt đầu bằng 1,
   * và số khác 1 chỉ được nhận nếu dòng trước đã là danh sách số.
   */
  anyOrderedStart?: boolean;
  /** Bản gốc: không đặt lại mức lồng khi gặp dòng thường, dòng thụt sau đoạn văn vẫn thành danh sách con. */
  keepNestingAcrossParagraphs?: boolean;
}

const BULLET = /^([*+-]) /;
const ORDERED = /^(\d{1,9})[.)] /;

/** Đếm số mức thụt đầu dòng: mỗi tab hoặc 4 dấu cách là một mức. */
function leadingIndent(line: string): { depth: number; rest: string } {
  let pos = 0;
  let depth = 0;
  for (;;) {
    if (line[pos] === '\t') pos += 1;
    else if (line.startsWith('    ', pos)) pos += 4;
    else break;
    depth++;
  }
  return { depth, rest: line.slice(pos) };
}

export function markdownToBlocks(text: string, o: PasteOptions = {}): Block[] {
  const out: Block[] = [];
  let inFence = false;
  let listOpen = false; // dòng trước có phải mục danh sách không
  let prevOrdered = false;

  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    if (line.startsWith('```')) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      out.push(block(line, 'code-block'));
      continue;
    }
    const { depth, rest } = leadingIndent(line);
    const canNest = listOpen && depth > 0;
    const body = depth > 0 && canNest ? rest : line;
    const lineDepth = canNest ? Math.min(depth, MAX_DEPTH) : 0;

    const bullet = BULLET.exec(body);
    const ordered = ORDERED.exec(body);
    if (bullet && (depth === 0 || canNest)) {
      out.push(block(body.slice(bullet[0].length), 'unordered-list-item', lineDepth));
      listOpen = true;
      prevOrdered = false;
      continue;
    }
    if (ordered && (depth === 0 || canNest) && (o.anyOrderedStart || ordered[1] === '1' || prevOrdered)) {
      out.push(block(body.slice(ordered[0].length), 'ordered-list-item', lineDepth));
      listOpen = true;
      prevOrdered = true;
      continue;
    }
    const s = depth === 0 ? SHORTCUTS.find((x) => !x.list && !x.fence && line.startsWith(x.prefix)) : undefined;
    if (s) {
      out.push(block(line.slice(s.prefix.length), s.type, 0, s.checked));
      listOpen = false;
    } else if (depth > 0 && !canNest) {
      out.push(block(rest, 'code-block')); // 4 dấu cách đầu dòng ngoài danh sách: code
      listOpen = false;
    } else {
      out.push(block(line));
      listOpen = o.keepNestingAcrossParagraphs ? listOpen : false;
    }
    prevOrdered = false;
  }
  return out.length ? out : [block()];
}

/** Bản mô phỏng hành vi gốc khi dán, để so sánh trong demo. */
export const legacyPaste = (text: string) =>
  markdownToBlocks(text, { anyOrderedStart: true, keepNestingAcrossParagraphs: true });
