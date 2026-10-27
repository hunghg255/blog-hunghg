/**
 * Soạn thảo cộng tác bằng Operational Transformation (OT), tối giản, cho văn bản thuần.
 *
 * Ý tưởng từ Glitch (source/otfs/ot-codemirror.js):
 * - Editor phát sự kiện "change" cho MỌI thay đổi, kể cả thay đổi do code áp vào. Khi áp op
 *   của người khác, bật cờ `ignoreNextChanges` để thay đổi đó không bị gửi ngược lên server (echo).
 * - Undo/redo là stack riêng chứa op nghịch đảo. Mỗi khi op của người khác tới, MỌI entry trong
 *   stack được transform theo op đó, để Ctrl+Z vẫn xoá đúng chữ mình gõ dù văn bản đã dịch chỗ.
 * - Gõ liên tiếp từng ký tự được gộp thành một bước undo (theo từ), tối đa 500 bước.
 */

export interface TextOp {
  type: 'insert' | 'remove';
  position: number;
  text: string;
}

// ---------------------------------------------------------------------------
// Op cơ bản
// ---------------------------------------------------------------------------

export function applyOps(doc: string, ops: TextOp[]): string {
  for (const op of ops) {
    if (op.position < 0 || op.position > doc.length) throw new RangeError(`op ngoài văn bản: ${op.position}`);
    if (op.type === 'insert') {
      doc = doc.slice(0, op.position) + op.text + doc.slice(op.position);
    } else {
      if (doc.slice(op.position, op.position + op.text.length) !== op.text) {
        throw new Error(`xoá sai chữ: muốn "${op.text}", thấy "${doc.slice(op.position, op.position + op.text.length)}"`);
      }
      doc = doc.slice(0, op.position) + doc.slice(op.position + op.text.length);
    }
  }
  return doc;
}

/** Ép op vào văn bản hiện có: kẹp vị trí, lấy đúng chữ đang nằm ở chỗ bị xoá. */
function fitOps(doc: string, ops: TextOp[]): TextOp[] {
  return ops.map((op) => {
    const position = Math.min(Math.max(0, op.position), doc.length);
    const fitted: TextOp =
      op.type === 'insert' ? { ...op, position } : { ...op, position, text: doc.slice(position, position + op.text.length) };
    doc = applyOps(doc, [fitted]);
    return fitted;
  });
}

/** Op nghịch đảo: áp sau `ops` thì về lại văn bản cũ (đảo thứ tự, đổi insert ↔ remove). */
export function invertOps(ops: TextOp[]): TextOp[] {
  return ops
    .map((op): TextOp => ({ ...op, type: op.type === 'insert' ? 'remove' : 'insert' }))
    .reverse();
}

/**
 * Transform một op `a` để áp được SAU `b` (cả hai cùng xuất phát từ một văn bản).
 * `aFirst`: khi hai bên chèn cùng chỗ, chữ của `a` đứng trước.
 */
function transformOne(a: TextOp, b: TextOp, aFirst: boolean): TextOp[] {
  const aEnd = a.position + a.text.length;
  if (b.type === 'insert') {
    const n = b.text.length;
    if (a.type === 'insert') {
      return a.position < b.position || (a.position === b.position && aFirst) ? [a] : [{ ...a, position: a.position + n }];
    }
    // a xoá [p, end): b chèn trước, sau, hoặc NẰM GIỮA vùng xoá
    if (aEnd <= b.position) return [a];
    if (a.position >= b.position) return [{ ...a, position: a.position + n }];
    const cut = b.position - a.position;
    return [
      { type: 'remove', position: a.position, text: a.text.slice(0, cut) },
      { type: 'remove', position: a.position + n, text: a.text.slice(cut) },
    ];
  }
  // b xoá [bp, bEnd)
  const bp = b.position;
  const bEnd = bp + b.text.length;
  if (a.type === 'insert') {
    if (a.position <= bp) return [a];
    if (a.position >= bEnd) return [{ ...a, position: a.position - b.text.length }];
    return [{ ...a, position: bp }]; // chèn vào giữa chỗ đã bị xoá: dồn về mép
  }
  // Cả hai cùng xoá: chỉ xoá phần b chưa xoá
  const left = a.position < bp ? a.text.slice(0, Math.min(aEnd, bp) - a.position) : '';
  const right = aEnd > bEnd ? a.text.slice(Math.max(a.position, bEnd) - a.position) : '';
  const text = left + right;
  if (!text) return [];
  const position = a.position < bp ? a.position : Math.max(bp, a.position - b.text.length);
  return [{ type: 'remove', position, text }];
}

/**
 * Transform hai DANH SÁCH op đồng thời: trả về [a', b'] sao cho apply(apply(doc, b), a') ===
 * apply(apply(doc, a), b'). `aFirst` quyết định thứ tự khi chèn cùng chỗ.
 */
export function transform(a: TextOp[], b: TextOp[], aFirst: boolean): [TextOp[], TextOp[]] {
  if (a.length === 0 || b.length === 0) return [a, b];
  if (a.length > 1) {
    const [a1, b1] = transform([a[0]], b, aFirst);
    const [aRest, b2] = transform(a.slice(1), b1, aFirst);
    return [[...a1, ...aRest], b2];
  }
  if (b.length > 1) {
    const [a1, b1] = transform(a, [b[0]], aFirst);
    const [a2, bRest] = transform(a1, b.slice(1), aFirst);
    return [a2, [...b1, ...bRest]];
  }
  return [transformOne(a[0], b[0], aFirst), transformOne(b[0], a[0], !aFirst)];
}

/** Dời một vị trí con trỏ qua các op. */
export function transformIndex(index: number, ops: TextOp[]) {
  for (const op of ops) {
    if (op.type === 'insert') {
      if (op.position < index) index += op.text.length;
    } else if (op.position < index) {
      index -= Math.min(op.text.length, index - op.position);
    }
  }
  return index;
}

/** Đổi một lần sửa trong textarea (giá trị cũ → mới) thành op: tìm phần đầu và đuôi giống nhau. */
export function diffToOps(before: string, after: string): TextOp[] {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let endBefore = before.length;
  let endAfter = after.length;
  while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) {
    endBefore--;
    endAfter--;
  }
  const ops: TextOp[] = [];
  if (endBefore > start) ops.push({ type: 'remove', position: start, text: before.slice(start, endBefore) });
  if (endAfter > start) ops.push({ type: 'insert', position: start, text: after.slice(start, endAfter) });
  return ops;
}

// ---------------------------------------------------------------------------
// Editor giả lập CodeMirror: phát "change" cho mọi thay đổi
// ---------------------------------------------------------------------------

export type ChangeOrigin = 'input' | 'remote' | 'history';

export class TextModel {
  value: string;
  private listeners = new Set<(ops: TextOp[], origin: ChangeOrigin) => void>();

  constructor(value = '') {
    this.value = value;
  }

  /**
   * `lenient`: áp như CodeMirror replaceRange — xoá theo vị trí và độ dài, không kiểm tra chữ.
   * Dùng để thấy undo "mù" xoá nhầm chữ của người khác.
   */
  apply(ops: TextOp[], origin: ChangeOrigin, lenient = false): TextOp[] {
    if (ops.length === 0) return ops;
    if (lenient) ops = fitOps(this.value, ops);
    this.value = applyOps(this.value, ops);
    this.listeners.forEach((fn) => fn(ops, origin));
    return ops;
  }

  onChange(fn: (ops: TextOp[], origin: ChangeOrigin) => void) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }
}

// ---------------------------------------------------------------------------
// Server và client (mô hình client–server kiểu ot.js / Google Wave)
// ---------------------------------------------------------------------------

export interface ServerMessage {
  clientId: string;
  revision: number;
  ops: TextOp[];
}

export class OTServer {
  doc: string;
  history: TextOp[][] = [];

  constructor(doc = '') {
    this.doc = doc;
  }

  get revision() {
    return this.history.length;
  }

  /** Nhận op của client viết trên bản `revision`; transform qua mọi op server đã nhận sau đó. */
  receive(clientId: string, revision: number, ops: TextOp[]): ServerMessage {
    let transformed = ops;
    for (const concurrent of this.history.slice(revision)) {
      // op đã có trong lịch sử thắng khi chèn cùng chỗ
      [transformed] = transform(transformed, concurrent, false);
    }
    this.doc = applyOps(this.doc, transformed);
    this.history.push(transformed);
    return { clientId, revision: this.history.length, ops: transformed };
  }
}

export interface OTClientOptions {
  clientId: string;
  model: TextModel;
  send: (revision: number, ops: TextOp[]) => void;
  /** Glitch: UNDO_LIMIT = 500 */
  undoLimit?: number;
  /** tắt để thấy echo: thay đổi do op của người khác bị gửi ngược lên server */
  ignoreRemoteChanges?: boolean;
  /** tắt để thấy undo sai chỗ khi người khác vừa sửa */
  transformHistory?: boolean;
}

export function createOTClient(options: OTClientOptions) {
  const { clientId, model, send, undoLimit = 500 } = options;
  let ignoreRemoteChanges = options.ignoreRemoteChanges ?? true;
  let transformHistory = options.transformHistory ?? true;

  let revision = 0;
  let outstanding: TextOp[] | null = null; // đã gửi, chờ server xác nhận
  let buffer: TextOp[] | null = null; // gõ trong lúc chờ
  const undoStack: TextOp[][] = []; // phần tử cuối = bước undo kế tiếp
  const redoStack: TextOp[][] = [];
  let ignoreNextChanges = false;

  const sendLocal = (ops: TextOp[]) => {
    if (outstanding) {
      buffer = buffer ? [...buffer, ...ops] : ops;
    } else {
      outstanding = ops;
      send(revision, ops);
    }
  };

  /** Gõ liên tiếp cùng loại, từng ký tự, cùng là chữ hoặc cùng là khoảng trắng → một bước undo. */
  const continuous = (prev: TextOp[] | undefined, inverse: TextOp[]) => {
    if (!prev || prev.length !== 1 || inverse.length !== 1) return false;
    const [a] = prev;
    const [b] = inverse;
    if (a.type !== b.type || b.text.length !== 1) return false;
    if (/\s/.test(a.text) !== /\s/.test(b.text)) return false;
    // inverse của "chèn" là "xoá": ký tự mới ngay sau đoạn cũ
    if (b.type === 'remove') return b.position === a.position + a.text.length;
    // inverse của "xoá lùi" (Backspace) là "chèn": ký tự mới ngay trước đoạn cũ
    return b.position + b.text.length === a.position;
  };

  const pushUndo = (inverse: TextOp[]) => {
    const top = undoStack[undoStack.length - 1];
    if (continuous(top, inverse)) {
      const [a] = top;
      const [b] = inverse;
      undoStack[undoStack.length - 1] =
        b.type === 'remove'
          ? [{ ...a, text: a.text + b.text }]
          : [{ ...b, text: b.text + a.text }];
    } else {
      undoStack.push(inverse);
      if (undoStack.length > undoLimit) undoStack.shift();
    }
  };

  /**
   * Op người khác `remote` (đã ở hệ toạ độ của văn bản hiện tại) → transform các stack.
   * Entry trên cùng áp lên văn bản hiện tại; entry sâu hơn áp lên văn bản SAU KHI các entry
   * phía trên đã undo, nên remote phải được transform dần qua từng entry (Glitch dùng chung
   * một remote cho mọi entry).
   */
  const rebaseStack = (stack: TextOp[][], remote: TextOp[]) => {
    let r = remote;
    for (let i = stack.length - 1; i >= 0; i--) {
      const [entry, rest] = transform(stack[i], r, true);
      stack[i] = entry;
      r = rest;
    }
    for (let i = stack.length - 1; i >= 0; i--) if (stack[i].length === 0) stack.splice(i, 1);
  };

  model.onChange((ops, origin) => {
    if (ignoreNextChanges) {
      ignoreNextChanges = false;
      return;
    }
    sendLocal(ops);
    if (origin === 'history') return; // undo/redo tự quản stack của nó
    pushUndo(invertOps(ops));
    redoStack.length = 0;
  });

  const applyHistory = (from: TextOp[][], to: TextOp[][]) => {
    const ops = from.pop();
    if (!ops) return false;
    // Không transform stack thì op có thể đã lệch chỗ: áp "mù" như CodeMirror để thấy hậu quả
    const applied = model.apply(ops, 'history', !transformHistory);
    to.push(invertOps(applied));
    return true;
  };

  return {
    clientId,
    get revision() {
      return revision;
    },
    get pending() {
      return (outstanding?.length ?? 0) + (buffer?.length ?? 0);
    },
    get undoDepth() {
      return undoStack.length;
    },
    get redoDepth() {
      return redoStack.length;
    },
    set ignoreRemoteChanges(v: boolean) {
      ignoreRemoteChanges = v;
    },
    set transformHistory(v: boolean) {
      transformHistory = v;
    },

    /** Server phát lại một op-list cho mọi client; của mình thì coi như ack. */
    receive(message: ServerMessage) {
      revision = message.revision;
      if (message.clientId === clientId) {
        outstanding = buffer;
        buffer = null;
        if (outstanding) send(revision, outstanding);
        return;
      }
      let remote = message.ops;
      // op của mình chưa tới server: transform op của người khác qua chúng (server sẽ làm ngược lại)
      if (outstanding) [outstanding, remote] = transform(outstanding, remote, false);
      if (buffer) [buffer, remote] = transform(buffer, remote, false);
      if (transformHistory) {
        rebaseStack(undoStack, remote);
        rebaseStack(redoStack, remote);
      }
      ignoreNextChanges = ignoreRemoteChanges;
      model.apply(remote, 'remote');
      ignoreNextChanges = false;
    },

    undo: () => applyHistory(undoStack, redoStack),
    redo: () => applyHistory(redoStack, undoStack),
  };
}

export type OTClient = ReturnType<typeof createOTClient>;
