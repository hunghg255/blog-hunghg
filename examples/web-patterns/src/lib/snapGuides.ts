/**
 * Đường gióng (smart guides) khi kéo object trên canvas, kiểu Figma/Canva.
 * Ý tưởng từ GuidelineHandler.js của Simplified (phái sinh từ OSS react-design-editor):
 * so tâm và 4 cạnh của object đang kéo với từng object khác, lệch trong ±4px thì hút vào
 * và vẽ một đường cam nối hai object.
 *
 * Khác bản gốc:
 * - Chọn ứng viên GẦN NHẤT trên mỗi trục, thay vì "khớp sau cùng thắng" (bản gốc gọi
 *   setPositionByOrigin cho mọi khớp, khớp nào xử lý sau cùng sẽ quyết định vị trí,
 *   trong khi đường gióng của các khớp trước vẫn được vẽ).
 * - Ngưỡng tính theo pixel MÀN HÌNH (chia cho zoom), zoom nhỏ vẫn hút như nhau.
 * - Hàm thuần: nhận hình chữ nhật, trả về độ dời + danh sách đường gióng. Không phụ thuộc fabric.
 */

export interface Box {
  id: string;
  x: number; // cạnh trái
  y: number; // cạnh trên
  w: number;
  h: number;
}

export interface Guide {
  axis: 'x' | 'y'; // 'x' = đường dọc tại x = pos, 'y' = đường ngang tại y = pos
  pos: number;
  from: number; // đoạn vẽ (theo trục còn lại)
  to: number;
}

export interface SnapResult {
  dx: number;
  dy: number;
  guides: Guide[];
}

export interface SnapOptions {
  /** ngưỡng hút, đơn vị pixel màn hình (bản gốc: 4) */
  threshold?: number;
  zoom?: number;
  /** khung làm việc: khớp với nó thì vẽ đường dài hết khung */
  frame?: Box;
  /** khoảng chừa ở hai đầu đường gióng (bản gốc: 5) */
  overshoot?: number;
}

/** 3 mốc trên một trục: cạnh đầu, tâm, cạnh cuối. */
const anchors = (b: Box, axis: 'x' | 'y') =>
  axis === 'x' ? [b.x, b.x + b.w / 2, b.x + b.w] : [b.y, b.y + b.h / 2, b.y + b.h];

interface Match {
  delta: number; // độ dời cần để khớp
  pos: number; // vị trí đường gióng
  other: Box;
}

function bestOnAxis(moving: Box, others: Box[], axis: 'x' | 'y', limit: number): Match[] {
  const mine = anchors(moving, axis);
  let best: Match[] = [];
  let bestAbs = Infinity;
  for (const other of others) {
    for (const target of anchors(other, axis)) {
      for (const source of mine) {
        const delta = target - source;
        const abs = Math.abs(delta);
        if (abs > limit) continue;
        if (abs < bestAbs - 1e-6) {
          bestAbs = abs;
          best = [{ delta, pos: target, other }];
        } else if (Math.abs(abs - bestAbs) <= 1e-6 && delta === best[0]?.delta) {
          // cùng độ dời: nhiều đường gióng cùng hiện (vd vừa thẳng cạnh trái vừa thẳng tâm của object khác)
          best.push({ delta, pos: target, other });
        }
      }
    }
  }
  return best;
}

export function computeSnap(moving: Box, others: Box[], { threshold = 4, zoom = 1, frame, overshoot = 5 }: SnapOptions = {}): SnapResult {
  const limit = threshold / zoom;
  const candidates = frame ? [...others, frame] : others;
  const xs = bestOnAxis(moving, candidates, 'x', limit);
  const ys = bestOnAxis(moving, candidates, 'y', limit);
  const dx = xs[0]?.delta ?? 0;
  const dy = ys[0]?.delta ?? 0;
  const snapped = { ...moving, x: moving.x + dx, y: moving.y + dy };

  const guides: Guide[] = [];
  for (const m of xs) {
    const isFrame = m.other === frame;
    const top = Math.min(snapped.y, m.other.y);
    const bottom = Math.max(snapped.y + snapped.h, m.other.y + m.other.h);
    guides.push({ axis: 'x', pos: m.pos, from: isFrame ? m.other.y : top - overshoot, to: isFrame ? m.other.y + m.other.h : bottom + overshoot });
  }
  for (const m of ys) {
    const isFrame = m.other === frame;
    const left = Math.min(snapped.x, m.other.x);
    const right = Math.max(snapped.x + snapped.w, m.other.x + m.other.w);
    guides.push({ axis: 'y', pos: m.pos, from: isFrame ? m.other.x : left - overshoot, to: isFrame ? m.other.x + m.other.w : right + overshoot });
  }
  // bỏ đường trùng nhau
  const seen = new Set<string>();
  return {
    dx,
    dy,
    guides: guides.filter((g) => {
      const k = `${g.axis}:${g.pos.toFixed(2)}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    }),
  };
}

/**
 * Bản mô phỏng logic gốc của Simplified để so sánh trong demo: duyệt object từ cuối về đầu,
 * khớp nào cũng dời object, đường gióng nào cũng được vẽ. Kết quả: khớp xử lý sau cùng thắng.
 */
export function computeSnapLastWins(moving: Box, others: Box[], { threshold = 4, zoom = 1 }: SnapOptions = {}): SnapResult {
  const inRange = (a: number, b: number) => Math.abs(Math.round(a) - Math.round(b)) <= threshold / zoom;
  let { x, y } = moving;
  const guides: Guide[] = [];
  const cx0 = moving.x + moving.w / 2;
  const cy0 = moving.y + moving.h / 2;
  for (let i = others.length; i--; ) {
    const o = others[i];
    const ocx = o.x + o.w / 2;
    const ocy = o.y + o.h / 2;
    // giống bản gốc: các phép so đều dùng toạ độ TRƯỚC khi hút (cx0, cy0)
    const pairsX: Array<[number, number]> = [
      [ocx, cx0],
      [o.x, cx0 - moving.w / 2],
      [o.x + o.w, cx0 + moving.w / 2],
    ];
    for (const [target, source] of pairsX) {
      if (inRange(target, source)) {
        x = moving.x + (target - source);
        guides.push({ axis: 'x', pos: target, from: Math.min(o.y, moving.y) - 5, to: Math.max(o.y + o.h, moving.y + moving.h) + 5 });
      }
    }
    const pairsY: Array<[number, number]> = [
      [ocy, cy0],
      [o.y, cy0 - moving.h / 2],
      [o.y + o.h, cy0 + moving.h / 2],
    ];
    for (const [target, source] of pairsY) {
      if (inRange(target, source)) {
        y = moving.y + (target - source);
        guides.push({ axis: 'y', pos: target, from: Math.min(o.x, moving.x) - 5, to: Math.max(o.x + o.w, moving.x + moving.w) + 5 });
      }
    }
  }
  return { dx: x - moving.x, dy: y - moving.y, guides };
}

// ---- Undo/redo bằng snapshot ----

/**
 * Lịch sử dạng snapshot, theo đúng nhịp của TransactionHandler: mỗi lần commit,
 * đẩy trạng thái TRƯỚC đó vào ngăn undo rồi mới ghi trạng thái mới; commit mới xoá ngăn redo.
 * Thêm so với bản gốc: giới hạn số bước, bỏ commit không đổi gì, và có undo/redo thật
 * (trong bản dump của Simplified, handler này chỉ còn save(); undo đi qua server).
 */
export interface History<T> {
  readonly present: T;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly size: { undo: number; redo: number };
  commit(next: T): boolean;
  undo(): T;
  redo(): T;
}

export function createHistory<T>(initial: T, { limit = 100, equals = defaultEquals }: { limit?: number; equals?: (a: T, b: T) => boolean } = {}): History<T> {
  // lưu snapshot dạng chuỗi JSON: bất biến, không lo bị sửa ngầm qua tham chiếu
  let present = JSON.stringify(initial);
  const undos: string[] = [];
  let redos: string[] = [];

  return {
    get present() {
      return JSON.parse(present) as T;
    },
    get canUndo() {
      return undos.length > 0;
    },
    get canRedo() {
      return redos.length > 0;
    },
    get size() {
      return { undo: undos.length, redo: redos.length };
    },
    commit(next) {
      if (equals(JSON.parse(present) as T, next)) return false;
      undos.push(present);
      if (undos.length > limit) undos.shift();
      present = JSON.stringify(next);
      redos = [];
      return true;
    },
    undo() {
      const previous = undos.pop();
      if (previous !== undefined) {
        redos.push(present);
        present = previous;
      }
      return JSON.parse(present) as T;
    },
    redo() {
      const next = redos.pop();
      if (next !== undefined) {
        undos.push(present);
        present = next;
      }
      return JSON.parse(present) as T;
    },
  };
}

function defaultEquals<T>(a: T, b: T) {
  return JSON.stringify(a) === JSON.stringify(b);
}
