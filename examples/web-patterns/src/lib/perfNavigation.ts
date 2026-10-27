/**
 * Chuyển trang an toàn khi người dùng bấm nhanh: trang nào được yêu cầu SAU CÙNG thì thắng,
 * dù trang trước tải xong muộn hơn. Bài học từ PageService.switchPage của web.postman.co
 * (appsdk/services/PageService.js), nơi chỉ cờ `_activeTransition` được bảo vệ khỏi race.
 */

export interface PageSwitcher {
  /**
   * `activate` nhận AbortSignal: bị huỷ khi có lần chuyển trang mới hơn.
   * Trả về true nếu trang này được hiển thị, false nếu đã bị lần chuyển khác vượt mặt.
   */
  switchPage<T>(name: string, activate: (signal: AbortSignal) => Promise<T>, commit: (result: T) => void): Promise<boolean>;
  readonly current: string | null;
}

export function createPageSwitcher(): PageSwitcher {
  let token = 0;
  let controller: AbortController | null = null;
  let current: string | null = null;

  return {
    async switchPage(name, activate, commit) {
      const mine = ++token;
      controller?.abort();
      controller = new AbortController();
      const { signal } = controller;
      try {
        const result = await activate(signal);
        // có lần chuyển trang mới hơn trong lúc chờ -> bỏ kết quả này
        if (mine !== token) return false;
        commit(result);
        current = name;
        return true;
      } catch (error) {
        if (signal.aborted || mine !== token) return false;
        throw error;
      }
    },
    get current() {
      return current;
    },
  };
}
