/**
 * Hai kỹ thuật nhỏ trong Outlook Web:
 *
 * 1. "Warm up" có đánh dấu synthetic (owa-group-prefetch-actions/warmUpFrequentlyUsedGroups.ts):
 *    10 giây sau khi khởi động, gọi trước một request rất nhẹ (lấy 1 dòng) cho tối đa 5 group
 *    người dùng hay mở, để server nạp sẵn dữ liệu của group vào cache. Request mang header
 *    `X-OWA-ActionSource: GroupModulePrefetch` để server KHÔNG tính nó là người dùng mở group.
 *
 * 2. Bit flags (owa-bit-flags): gom nhiều cờ bật/tắt của giao diện vào MỘT số nguyên lưu ở
 *    cấu hình người dùng trên server.
 */

// ---------------------------------------------------------------------------
// 1. Warm-up đánh dấu synthetic
// ---------------------------------------------------------------------------

export const SYNTHETIC_SOURCE_HEADER = 'X-Action-Source';

export interface WarmUpCandidate {
  id: string;
  favorite: boolean;
  /** lần cuối người dùng mở (ms since epoch), không có = chưa mở bao giờ */
  lastVisited?: number;
  /** vị trí trong thanh điều hướng (0 = trên cùng) */
  rank: number;
}

export interface PickOptions {
  max?: number;
  /** chỉ warm group mở trong N ngày gần đây */
  maxDaysSinceVisit?: number;
  /** chỉ xét group không yêu thích nằm trong N vị trí đầu (Outlook: số group hiện khi thu gọn) */
  topNonFavorites?: number;
  now?: number;
}

const DAY = 86_400_000;

/** Chọn group để warm: group yêu thích trước, thiếu thì lấy thêm group đứng đầu danh sách. */
export function pickWarmUpTargets(
  candidates: WarmUpCandidate[],
  { max = 5, maxDaysSinceVisit = 30, topNonFavorites = 5, now = Date.now() }: PickOptions = {},
): string[] {
  const recent = (c: WarmUpCandidate) => c.lastVisited !== undefined && now - c.lastVisited <= maxDaysSinceVisit * DAY;
  const sorted = [...candidates].sort((a, b) => a.rank - b.rank);
  const favorites = sorted.filter((c) => c.favorite && recent(c));
  const others = sorted.filter((c) => !c.favorite && c.rank < topNonFavorites && recent(c));
  return [...favorites, ...others].slice(0, max).map((c) => c.id);
}

export interface WarmUpOptions {
  candidates: () => WarmUpCandidate[];
  /** gửi request warm-up; PHẢI chuyển `headers` xuống request thật */
  warm: (id: string, headers: Headers) => Promise<unknown>;
  delayMs?: number;
  pick?: PickOptions;
}

export function createWarmUp({ candidates, warm, delayMs = 10_000, pick }: WarmUpOptions) {
  let triggered = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let warmed = new Set<string>();
  let warmedAt = 0;

  return {
    /** gọi bao nhiêu lần cũng chỉ chạy một lần */
    trigger() {
      if (triggered) return;
      triggered = true;
      timer = setTimeout(() => {
        const ids = pickWarmUpTargets(candidates(), pick);
        // Outlook: nếu người dùng không mở group nào trong 30 ngày thì thôi, không warm gì cả
        if (ids.length === 0) return;
        warmedAt = Date.now();
        warmed = new Set(ids);
        for (const id of ids) {
          const headers = new Headers({ [SYNTHETIC_SOURCE_HEADER]: 'prefetch' });
          // lỗi của request phụ không được làm phiền ai: nuốt, không đẩy lên hệ thống báo lỗi
          warm(id, headers).catch(() => {});
        }
      }, delayMs);
    },
    /** để gắn vào số liệu khi người dùng mở group thật: group này có được warm không, cách bao lâu */
    measure(id: string): { warmed: boolean; msSinceWarmUp?: number } {
      return warmed.has(id) ? { warmed: true, msSinceWarmUp: Date.now() - warmedAt } : { warmed: false };
    },
    cancel() {
      clearTimeout(timer);
    },
  };
}

/** Phía server: request có header synthetic thì không cộng vào số liệu "người dùng mở". */
export const isSynthetic = (headers: Headers) => headers.has(SYNTHETIC_SOURCE_HEADER);

// ---------------------------------------------------------------------------
// 2. Bit flags
// ---------------------------------------------------------------------------

/**
 * Định nghĩa cờ bằng vị trí bit CỐ ĐỊNH. Giá trị đã nằm trong cấu hình của hàng triệu người
 * dùng, nên vị trí một khi đã dùng thì không bao giờ đổi hay dùng lại cho cờ khác.
 */
export function defineBitFlags<const T extends Record<string, number>>(positions: T) {
  for (const [name, bit] of Object.entries(positions)) {
    // bit 31 là bit dấu của Integer32 bên server: tránh luôn cho khỏi lẫn số âm
    if (!Number.isInteger(bit) || bit < 0 || bit > 30) throw new RangeError(`${name}: bit ${bit} ngoài 0–30`);
  }
  const bits = Object.values(positions);
  if (new Set(bits).size !== bits.length) throw new Error('hai cờ trùng một vị trí bit');

  const mask = (name: keyof T) => 1 << positions[name];
  return {
    has: (value: number | undefined, name: keyof T) => ((value ?? 0) & mask(name)) !== 0,
    /** trả về số mới; giá trị đang là 0 hoặc chưa có vẫn đặt được (xem "Khác bản gốc" trong bài) */
    set: (value: number | undefined, name: keyof T, on: boolean) =>
      on ? (value ?? 0) | mask(name) : (value ?? 0) & ~mask(name),
    names: Object.keys(positions) as (keyof T)[],
    positions,
  };
}

/**
 * Cập nhật một cờ và chỉ gọi `persist` khi giá trị thật sự đổi (Outlook cũng bỏ qua nếu cờ đã
 * đúng giá trị, đỡ một request ghi cấu hình).
 */
export function updateFlag<T extends Record<string, number>>(
  flags: ReturnType<typeof defineBitFlags<T>>,
  current: number | undefined,
  name: keyof T,
  on: boolean,
  persist: (next: number) => void,
): number {
  if (flags.has(current, name) === on) return current ?? 0;
  const next = flags.set(current, name, on);
  persist(next);
  return next;
}
