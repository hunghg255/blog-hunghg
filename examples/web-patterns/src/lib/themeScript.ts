/**
 * Dark mode không nháy (ý tưởng từ InitializeColorMode của theme-ui trên gatsbyjs.com).
 *
 * Một đoạn script nhỏ được inline vào <head>, chạy ĐỒNG BỘ trước khi trình duyệt vẽ frame đầu:
 * đọc lựa chọn đã lưu, nếu chưa chọn thì theo hệ điều hành, rồi đặt `data-theme` + `color-scheme`
 * lên <html>. CSS chỉ cần đọc `[data-theme='dark']`, nên trang hiện đúng màu ngay từ pixel đầu tiên.
 */

export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

export interface ThemeScriptOptions {
  /** khoá localStorage, mặc định 'theme' */
  storageKey?: string;
  /** attribute đặt lên <html>, mặc định 'data-theme' */
  attribute?: string;
}

/**
 * Hàm này được chuyển thành chuỗi bằng `toString()` rồi inline vào HTML, nên phải TỰ ĐỦ:
 * không import, không gọi hàm khác trong module, chỉ dùng cú pháp mọi trình duyệt hiểu.
 */
function applyInitialTheme(storageKey: string, attribute: string) {
  var root = document.documentElement;
  var theme = 'light';
  try {
    var stored = localStorage.getItem(storageKey);
    if (stored === 'light' || stored === 'dark') {
      theme = stored;
    } else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      theme = 'dark';
    }
  } catch (e) {
    // localStorage bị chặn (cookie bị tắt, sandbox iframe…): vẫn theo hệ điều hành được
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) theme = 'dark';
  }
  root.setAttribute(attribute, theme);
  // color-scheme: thanh cuộn, ô input, nền mặc định của trình duyệt cũng đổi màu theo
  root.style.colorScheme = theme;
}

/** Chuỗi JS để đặt trong <script> ở <head>, trước mọi stylesheet/script khác. */
export function themeInitScript({ storageKey = 'theme', attribute = 'data-theme' }: ThemeScriptOptions = {}) {
  return `(${applyInitialTheme.toString()})(${JSON.stringify(storageKey)}, ${JSON.stringify(attribute)})`;
}
