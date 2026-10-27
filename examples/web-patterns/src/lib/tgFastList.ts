/**
 * Cập nhật một danh sách DOM có key với ít thao tác DOM nhất, theo ý tưởng `teactFastList`
 * trong renderer tự viết của Telegram Web A (lib/teact/teact-dom.ts):
 *
 * 1. Xoá các node có key không còn trong danh sách mới.
 * 2. Duyệt danh sách mới. Các item MỚI nằm liền nhau được gom vào một DocumentFragment và
 *    chèn một lần (tải thêm 50 tin = 1 lần chèn thay vì 50).
 * 3. Node cũ chỉ bị di chuyển khi vị trí lệch VÀ `order` của nó đổi. Không có `order`
 *    thì không bao giờ di chuyển: Telegram dùng chế độ này khi vị trí hiển thị do CSS quyết định
 *    (vd. `top: i * 72px` trong danh sách chat), thứ tự trong DOM không còn quan trọng.
 */

export interface DomOps {
  inserted: number;
  moved: number;
  removed: number;
  /** số lần chèn bằng fragment (mỗi lần có thể chứa nhiều node) */
  fragments: number;
}

export interface KeyedListOptions<T> {
  getKey: (item: T) => string;
  /** "thứ tự" của item; đổi thì node mới được phép di chuyển trong DOM */
  getOrder?: (item: T, index: number) => number | string | undefined;
  create: (item: T) => HTMLElement;
  update?: (node: HTMLElement, item: T) => void;
}

interface Rendered {
  node: HTMLElement;
  order: number | string | undefined;
}

const renderedByParent = new WeakMap<HTMLElement, Map<string, Rendered>>();

function adoptChildren(parent: HTMLElement) {
  const adopted = new Map<string, Rendered>();
  for (const child of Array.from(parent.children) as HTMLElement[]) {
    if (child.dataset.key !== undefined) adopted.set(child.dataset.key, { node: child, order: undefined });
    else child.remove();
  }
  return adopted;
}

export function renderKeyedList<T>(parent: HTMLElement, items: T[], options: KeyedListOptions<T>): DomOps {
  const { getKey, getOrder, create, update } = options;
  const ops: DomOps = { inserted: 0, moved: 0, removed: 0, fragments: 0 };
  // Lần đầu (hoặc DOM do code khác dựng): nhận các node đã có `data-key` làm trạng thái cũ.
  const previous = renderedByParent.get(parent) ?? adoptChildren(parent);
  const newKeys = new Set(items.map(getKey));

  // 1. Xoá node không còn, ghi lại vị trí (theo thứ tự DOM) của các node còn lại.
  const remaining = new Map<string, Rendered & { index: number }>();
  let remainingIndex = 0;
  for (const [key, rendered] of previous) {
    if (!newKeys.has(key)) {
      rendered.node.remove();
      ops.removed++;
    }
  }
  // thứ tự DOM thật sau khi xoá (Map giữ thứ tự chèn, nhưng node có thể đã bị di chuyển)
  for (const child of Array.from(parent.children) as HTMLElement[]) {
    const key = child.dataset.key;
    const rendered = key !== undefined ? previous.get(key) : undefined;
    if (key !== undefined && rendered && newKeys.has(key)) {
      remaining.set(key, { ...rendered, index: remainingIndex++ });
    }
  }

  const next = new Map<string, Rendered>();
  let queue: { item: T; key: string; index: number }[] = [];
  let queueIndex = 0;
  let preservedIndex = 0;

  const flushQueue = () => {
    if (queue.length === 0) return;
    const reference = parent.children[queueIndex] ?? null;
    if (queue.length === 1) {
      const { item, key, index } = queue[0];
      const node = createNode(item, key, index);
      parent.insertBefore(node, reference);
    } else {
      const fragment = document.createDocumentFragment();
      queue.forEach(({ item, key, index }) => fragment.appendChild(createNode(item, key, index)));
      parent.insertBefore(fragment, reference);
      ops.fragments++;
    }
    ops.inserted += queue.length;
    queue = [];
  };

  const createNode = (item: T, key: string, index: number) => {
    const node = create(item);
    node.dataset.key = key;
    next.set(key, { node, order: getOrder?.(item, index) });
    return node;
  };

  // 2 + 3. Duyệt danh sách mới.
  items.forEach((item, i) => {
    const key = getKey(item);
    const info = remaining.get(key);
    if (!info) {
      if (queue.length === 0) queueIndex = i;
      queue.push({ item, key, index: i });
      return;
    }
    flushQueue();

    const order = getOrder?.(item, i);
    const shouldMove = info.index !== preservedIndex && info.order !== order;
    const isMovingDown = shouldMove && preservedIndex > info.index;
    // Khi node đi xuống, các node phía sau "dồn lên" nên chỉ số giữ chỗ vẫn tăng.
    if (!shouldMove || isMovingDown) preservedIndex++;

    if (shouldMove) {
      const reference = parent.children[isMovingDown ? i + 1 : i] ?? null;
      if (reference !== info.node) {
        parent.insertBefore(info.node, reference);
        ops.moved++;
      }
    }
    update?.(info.node, item);
    next.set(key, { node: info.node, order });
  });
  flushQueue();

  renderedByParent.set(parent, next);
  return ops;
}

/** Cách ngây thơ để so sánh: dựng lại toàn bộ danh sách mỗi lần. */
export function renderByRebuild<T>(parent: HTMLElement, items: T[], options: KeyedListOptions<T>): DomOps {
  const removed = parent.children.length;
  const fragment = document.createDocumentFragment();
  items.forEach((item) => {
    const node = options.create(item);
    node.dataset.key = options.getKey(item);
    fragment.appendChild(node);
  });
  parent.replaceChildren(fragment);
  renderedByParent.delete(parent);
  return { inserted: items.length, moved: 0, removed, fragments: 1 };
}

/** Cách "có key nhưng không khéo": giữ node cũ nhưng appendChild lại tất cả theo thứ tự mới. */
export function renderByReappend<T>(parent: HTMLElement, items: T[], options: KeyedListOptions<T>): DomOps {
  const ops: DomOps = { inserted: 0, moved: 0, removed: 0, fragments: 0 };
  const byKey = new Map<string, HTMLElement>();
  for (const child of Array.from(parent.children) as HTMLElement[]) {
    if (child.dataset.key !== undefined) byKey.set(child.dataset.key, child);
  }
  const keys = new Set(items.map(options.getKey));
  for (const [key, node] of byKey) {
    if (!keys.has(key)) {
      node.remove();
      ops.removed++;
    }
  }
  items.forEach((item) => {
    const key = options.getKey(item);
    let node = byKey.get(key);
    if (!node) {
      node = options.create(item);
      node.dataset.key = key;
      ops.inserted++;
    } else {
      options.update?.(node, item);
      ops.moved++;
    }
    parent.appendChild(node);
  });
  renderedByParent.delete(parent);
  return ops;
}
