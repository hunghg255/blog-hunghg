/**
 * Cấp màu cho các series của biểu đồ khi người dùng thêm/bớt series liên tục.
 *
 * Ý tưởng từ Similarweb (components/colorsStack/ColorStack.ts): một "ngăn xếp" màu,
 * acquire() lấy màu, release() trả màu về để dùng lại. Bản này đổi 3 chỗ:
 * - gắn màu với id của series, nên release 2 lần hay release nhầm màu không làm hỏng pool
 *   (bản gốc sẽ có cùng một màu 2 lần trong danh sách màu trống);
 * - series quay lại thì pool tự trả màu cũ của nó nếu màu đó còn trống. Bảng của Similarweb
 *   tự giữ màu cũ trên hàng nhưng không lấy nó ra khỏi stack, nên màu đó bị cấp trùng sau đó;
 * - hết màu thì chọn màu đang được dùng ít nhất, tính từ trạng thái thật, thay vì reset
 *   danh sách rồi cấp lại từ màu đầu tiên.
 */
export interface ColorPool {
  acquire(id: string): string;
  release(id: string): void;
  colorOf(id: string): string | undefined;
  /** số series đang dùng mỗi màu, theo thứ tự palette */
  usage(): Array<{ color: string; count: number }>;
  reset(): void;
}

export function createColorPool(palette: readonly string[]): ColorPool {
  if (palette.length === 0) throw new Error('palette rỗng');
  const assigned = new Map<string, string>(); // id -> màu đang dùng
  const remembered = new Map<string, string>(); // id -> màu lần trước (để trả lại đúng màu cũ)

  const countOf = (color: string) => {
    let n = 0;
    for (const c of assigned.values()) if (c === color) n++;
    return n;
  };

  return {
    acquire(id) {
      const current = assigned.get(id);
      if (current) return current; // gọi lại cho cùng series: không cấp màu mới

      const previous = remembered.get(id);
      let color: string;
      if (previous && countOf(previous) === 0) {
        color = previous;
      } else {
        // màu ít người dùng nhất; hoà thì lấy màu đứng trước trong palette
        // (palette thường xếp theo độ dễ phân biệt giảm dần)
        color = palette.reduce((best, c) => (countOf(c) < countOf(best) ? c : best), palette[0]);
      }
      assigned.set(id, color);
      remembered.set(id, color);
      return color;
    },
    release(id) {
      assigned.delete(id);
    },
    colorOf: (id) => assigned.get(id),
    usage: () => palette.map((color) => ({ color, count: countOf(color) })),
    reset() {
      assigned.clear();
      remembered.clear();
    },
  };
}
