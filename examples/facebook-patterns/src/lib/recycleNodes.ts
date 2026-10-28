/**
 * Structural sharing: so cây dữ liệu cũ (prev) với cây mới (next), nhánh nào có nội dung
 * bằng nhau thì dùng lại tham chiếu cũ. Ý tưởng từ recycleNodesInto của Relay, viết lại:
 * - so khoá cả hai phía (bản trong bundle chỉ đếm số khoá nên {x:1} và {y:undefined} bị coi là bằng),
 * - chỉ đi vào object thường và mảng (Map, Set, Date, class… luôn lấy bản mới),
 * - không sửa `next` đã bị freeze; mặc định cũng không sửa `next`, chỉ tạo bản sao khi cần.
 */

export interface RecycleOptions {
  /**
   * true: ghi tham chiếu cũ thẳng vào `next` như Relay (nhanh, không cấp phát thêm).
   * false (mặc định): `next` giữ nguyên, nhánh nào cần ghép thì sao chép nông nhánh đó.
   */
  mutate?: boolean;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function hasOwn(obj: object, key: string) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

export function recycleNodesInto<T>(prev: unknown, next: T, options: RecycleOptions = {}): T {
  return recycle(prev, next, options.mutate === true) as T;
}

function recycle(prev: unknown, next: unknown, mutate: boolean): unknown {
  if (prev === next) return next;
  const bothArrays = Array.isArray(prev) && Array.isArray(next);
  const bothPlain = isPlainObject(prev) && isPlainObject(next);
  if (!bothArrays && !bothPlain) return next;

  const canWrite = mutate && !Object.isFrozen(next);
  const src = next as Record<string, unknown>;
  const old = prev as Record<string, unknown>;
  // out: nơi ghi tham chiếu đã tái dùng; chỉ sao chép khi có ít nhất một nhánh con đổi tham chiếu
  let out: Record<string, unknown> | null = canWrite ? src : null;
  let allSame = true;

  const keys = bothArrays ? null : Object.keys(src);
  const len = bothArrays ? (next as unknown[]).length : keys!.length;
  for (let i = 0; i < len; i++) {
    const key = bothArrays ? String(i) : keys![i];
    const inPrev = bothArrays ? i < (prev as unknown[]).length : hasOwn(old, key);
    const child = recycle(inPrev ? old[key] : undefined, src[key], mutate);
    if (child !== src[key]) {
      if (out === null)
        out = (bothArrays ? [...(next as unknown[])] : { ...src }) as Record<string, unknown>;
      out[key] = child;
    }
    if (!inPrev || child !== old[key]) allSame = false;
  }
  const prevLen = bothArrays ? (prev as unknown[]).length : Object.keys(old).length;
  if (allSame && prevLen === len) return prev;
  return out ?? next;
}

/** Đếm số nút (object/mảng) của `result` còn là chính tham chiếu trong `prev`, để demo và test. */
export function countShared(prev: unknown, result: unknown): { shared: number; fresh: number } {
  const prevNodes = new Set<unknown>();
  const collect = (v: unknown) => {
    if (v === null || typeof v !== 'object' || prevNodes.has(v)) return;
    prevNodes.add(v);
    Object.values(v as object).forEach(collect);
  };
  collect(prev);
  let shared = 0;
  let fresh = 0;
  const seen = new Set<unknown>();
  const walk = (v: unknown) => {
    if (v === null || typeof v !== 'object' || seen.has(v)) return;
    seen.add(v);
    if (prevNodes.has(v)) {
      shared++;
      return; // cả nhánh con cũng là của prev, không cần đi tiếp
    }
    fresh++;
    Object.values(v as object).forEach(walk);
  };
  walk(result);
  return { shared, fresh };
}
