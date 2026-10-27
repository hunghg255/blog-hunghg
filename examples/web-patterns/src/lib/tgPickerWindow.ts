/**
 * Bảng emoji/sticker chỉ render nhóm đang xem (Telegram #17).
 *
 * Ba mẹo:
 * 1. Chiều cao từng nhóm TÍNH TRƯỚC từ số phần tử, nên thanh cuộn đúng ngay khi chưa render gì.
 * 2. Chỉ nhóm trong khoảng [active − 1, active + 1] mới render nội dung.
 * 3. "Nhóm đang xem" = phần tử GIỮA trong các nhóm đang giao với khung nhìn.
 * Kèm một bộ "đóng băng" animation dùng bộ đếm, để nhiều nguồn cùng tạm dừng mà không giẫm chân nhau.
 */

export const ITEM_SIZE = 40;
export const ITEM_MARGIN = 4;
export const DESKTOP_PER_ROW = 9;
export const MOBILE_PADDING = 8;

export function itemsPerRow(containerWidth: number, isMobile: boolean) {
  if (!isMobile) return DESKTOP_PER_ROW;
  return Math.max(1, Math.floor((containerWidth - MOBILE_PADDING) / (ITEM_SIZE + ITEM_MARGIN)));
}

/** Chiều cao phần thân của một nhóm: số hàng × (40 + 4). */
export const categoryBodyHeight = (count: number, perRow: number) =>
  Math.ceil(count / perRow) * (ITEM_SIZE + ITEM_MARGIN);

/** Nhóm i có được render nội dung không, khi đang xem nhóm `active`. */
export const shouldRenderCategory = (active: number, i: number, radius = 1) => Math.abs(active - i) <= radius;

/**
 * Chọn nhóm đang xem từ trạng thái giao cắt của các nhóm.
 * Không lấy nhóm đầu tiên đang giao (nó thường chỉ còn vài pixel ở mép trên) mà lấy nhóm giữa.
 */
export function pickActiveCategory(intersecting: ReadonlyMap<number, boolean>): number | undefined {
  const visible = [...intersecting].filter(([, v]) => v).map(([i]) => i).sort((a, b) => a - b);
  if (visible.length === 0) return undefined;
  return visible[Math.floor(visible.length / 2)];
}

/**
 * Cuộn thanh tab nhóm sao cho nút đang chọn nằm giữa.
 * Bản gốc: newLeft = index × 42 − width/2 + 42/2 (42 = bề rộng nút gồm margin).
 */
export function centeredHeaderScroll(index: number, headerWidth: number, buttonWidth = 42) {
  return Math.max(0, index * buttonWidth - headerWidth / 2 + buttonWidth / 2);
}

// ---------- Đóng băng animation ----------

export interface Freezable {
  isPlaying(): boolean;
  play(): void;
  pause(): void;
}

/**
 * Nhiều nguồn có thể cùng yêu cầu dừng: tab ẩn, đang có animation nặng (mở menu, cuộn nhanh), modal…
 * Bản gốc dùng MỘT cờ boolean `isFrozen` cho mọi nguồn: nguồn nào mở trước là animation chạy lại,
 * dù nguồn kia vẫn đang yêu cầu dừng. Ở đây mỗi nguồn được đếm riêng.
 */
export function createFreezer(target: Freezable) {
  const reasons = new Set<string>();
  let wasPlaying = false;
  /** prop `play` đổi trong lúc bị đóng băng: chỉ ghi nhận, chạy khi hết đóng băng */
  let wantPlay: boolean | undefined;

  return {
    freeze(reason: string) {
      if (reasons.size === 0) {
        wasPlaying = target.isPlaying();
        target.pause();
      }
      reasons.add(reason);
    },
    unfreeze(reason: string) {
      if (!reasons.delete(reason) || reasons.size > 0) return;
      const shouldPlay = wantPlay ?? wasPlaying;
      wantPlay = undefined;
      if (shouldPlay) target.play();
    },
    setPlay(play: boolean) {
      if (reasons.size > 0) {
        wantPlay = play;
        return;
      }
      if (play) target.play();
      else target.pause();
    },
    get frozenBy() {
      return [...reasons];
    },
  };
}

/** Bản giống gốc (một cờ boolean), để so sánh trong demo. */
export function createBooleanFreezer(target: Freezable) {
  let isFrozen = false;
  let wasPlaying = false;
  return {
    freeze(_reason: string) {
      isFrozen = true;
      if (!wasPlaying) wasPlaying = target.isPlaying();
      target.pause();
    },
    unfreeze(_reason: string) {
      if (wasPlaying) target.play();
      wasPlaying = false;
      isFrozen = false;
    },
    setPlay(play: boolean) {
      if (isFrozen) {
        wasPlaying = play;
        return;
      }
      if (play) target.play();
      else target.pause();
    },
    get frozenBy() {
      return isFrozen ? ['(1 cờ chung)'] : [];
    },
  };
}
