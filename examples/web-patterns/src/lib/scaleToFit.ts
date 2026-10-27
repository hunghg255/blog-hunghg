/**
 * Thu nhỏ nội dung rộng cố định (bảng email 600–800px) cho vừa khung đọc hẹp, thay vì để tràn
 * và hiện thanh cuộn ngang. Ý tưởng từ owa-controls-content-handler-wide của Outlook Web.
 */

const SCALE_ATTR = 'data-scale';
const WRAPPER_ATTR = 'data-scale-wrapper';
const MIN_WRAPPER_HEIGHT = 40;

/** Margin trái + phải. Chrome có thể trả margin âm cho bảng căn giữa (`margin: 0 auto`), coi là 0. */
export function horizontalMargins(el: HTMLElement): number {
  const cs = getComputedStyle(el);
  return Math.max(parseFloat(cs.marginLeft) || 0, 0) + Math.max(parseFloat(cs.marginRight) || 0, 0);
}

function verticalMargins(el: HTMLElement): number {
  const cs = getComputedStyle(el);
  return (parseFloat(cs.marginTop) || 0) + (parseFloat(cs.marginBottom) || 0);
}

function getWrapper(el: HTMLElement): HTMLElement {
  const parent = el.parentElement;
  if (parent?.hasAttribute(WRAPPER_ATTR)) return parent;
  const wrapper = document.createElement('div');
  wrapper.setAttribute(WRAPPER_ATTR, '');
  // overflow: hidden để phần "bóng ma" của box chưa scale (transform không đổi layout) không tràn ra
  wrapper.style.overflow = 'hidden';
  el.before(wrapper);
  wrapper.append(el);
  return wrapper;
}

export interface ScaleResult {
  element: HTMLElement;
  scale: number;
  /** nội dung tràn do phần tử con có width cố định, không scale được mà chỉ bọc lại */
  overflowOnly: boolean;
}

/**
 * Thu nhỏ `el` cho vừa `availableWidth`. Không bao giờ phóng to (scale tối đa 1).
 * `transform: scale()` không đổi kích thước layout, nên phải bọc một div có height = chiều cao sau scale.
 */
export function scaleToFit(el: HTMLElement, availableWidth: number, rtl = false): ScaleResult | null {
  // offsetWidth/offsetHeight là kích thước layout: transform không ảnh hưởng, nên đo được cả khi đang scale
  const width = el.offsetWidth;
  if (availableWidth <= 0 || width <= 0) return null;
  const available = availableWidth - horizontalMargins(el);
  const scale = Math.min(1, available / width);

  if (scale < 1) {
    el.style.transform = `scale(${scale})`;
    el.style.transformOrigin = rtl ? 'top right' : 'top left';
    el.setAttribute(SCALE_ATTR, String(scale));
    const wrapper = getWrapper(el);
    wrapper.style.height = `${Math.max(Math.ceil(el.offsetHeight * scale) + verticalMargins(el), MIN_WRAPPER_HEIGHT)}px`;
    return { element: el, scale, overflowOnly: false };
  }

  resetScale(el);
  if (el.scrollWidth > available) {
    // bảng vừa nhưng ô bên trong có width cố định: bọc lại để cuộn ngang cục bộ, không vỡ cả trang
    const wrapper = getWrapper(el);
    wrapper.style.overflowX = 'auto';
    return { element: el, scale: 1, overflowOnly: true };
  }
  return { element: el, scale: 1, overflowOnly: false };
}

/** Bỏ scale (nút "phóng to" hoặc khung đã đủ rộng). Wrapper giữ lại để lần scale sau dùng tiếp. */
export function resetScale(el: HTMLElement) {
  el.style.transform = '';
  el.style.transformOrigin = '';
  el.removeAttribute(SCALE_ATTR);
  const wrapper = el.parentElement;
  if (wrapper?.hasAttribute(WRAPPER_ATTR)) wrapper.style.height = '';
}

/**
 * Bỏ phần tử nằm trong một phần tử khác của danh sách: bảng lồng bảng (rất phổ biến trong email)
 * chỉ scale bảng ngoài cùng, scale cả bảng con là thu nhỏ hai lần.
 */
export function outermostOnly<T extends Element>(elements: T[]): T[] {
  return elements.filter((el) => !elements.some((other) => other !== el && other.contains(el)));
}

/**
 * Đợi ảnh trong `root` tải xong (hoặc lỗi) vì ảnh làm bảng đổi kích thước.
 * Có hạn chót: ảnh treo thì cứ tính, đừng để bảng tràn mãi. Outlook dùng 2 giây.
 */
export function waitForImages(root: ParentNode, timeoutMs = 2000): Promise<{ timedOut: boolean }> {
  const pending = [...root.querySelectorAll('img')].filter((img) => img.src && !img.complete);
  if (pending.length === 0) return Promise.resolve({ timedOut: false });
  return new Promise((resolve) => {
    let left = pending.length;
    const timer = setTimeout(() => finish(true), timeoutMs);
    const done = () => {
      left--;
      if (left === 0) finish(false);
    };
    function finish(timedOut: boolean) {
      clearTimeout(timer);
      pending.forEach((img) => {
        img.removeEventListener('load', done);
        img.removeEventListener('error', done);
      });
      resolve({ timedOut });
    }
    pending.forEach((img) => {
      img.addEventListener('load', done);
      img.addEventListener('error', done);
    });
  });
}

/**
 * Gắn vào một khung đọc: scale mọi bảng ngoài cùng, và tính lại khi khung đổi bề rộng
 * (kéo thanh chia, xoay điện thoại). Handler của Outlook không có phần theo dõi khung đổi cỡ.
 * Trả về hàm huỷ.
 */
export function autoScaleTables(
  container: HTMLElement,
  onScaled?: (results: ScaleResult[]) => void,
  rtl = false,
): () => void {
  let frame = 0;
  let cancelled = false;
  const run = () => {
    const tables = outermostOnly([...container.querySelectorAll<HTMLElement>('table')]);
    const results = tables
      .map((t) => scaleToFit(t, container.clientWidth, rtl))
      .filter((r): r is ScaleResult => r !== null);
    onScaled?.(results);
  };

  // ResizeObserver gọi callback sau layout; gom về một lần mỗi frame.
  // Chỉ bắt đầu theo dõi sau khi ảnh tải xong: RO gọi callback ngay khi observe, và đo lúc ảnh
  // chưa có kích thước thì chiều cao wrapper sẽ sai.
  const ro = new ResizeObserver(() => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(run);
  });
  void waitForImages(container).then(() => {
    if (!cancelled) ro.observe(container);
  });
  return () => {
    cancelled = true;
    cancelAnimationFrame(frame);
    ro.disconnect();
  };
}

// ---- Emoji bị hiện thành ô vuông / đen trắng trong email đặt font-family riêng ----

/**
 * @font-face "EmojiFont" chỉ trỏ tới font emoji CÓ SẴN trên máy (local()), và nhờ unicode-range
 * chỉ áp cho ký tự emoji. Outlook dùng dải tới U+1F9FF; ở đây mở rộng tới U+1FAFF để có cả
 * emoji mới (🫠 🪴 …), và thêm biến thể chọn emoji U+FE0F, ZWJ U+200D.
 */
export const EMOJI_FONT_FACE = `@font-face {
  font-family: EmojiFont;
  src: local("Apple Color Emoji"), local("Segoe UI Emoji"), local("Noto Color Emoji"),
       local("NotoColorEmoji"), local("Segoe UI Symbol");
  unicode-range: U+00A9, U+00AE, U+200D, U+203C, U+2049, U+2122, U+2139, U+2194-21AA,
                 U+231A-23FF, U+24C2, U+25AA-27BF, U+2934-2935, U+2B05-2B55, U+3030, U+303D,
                 U+3297, U+3299, U+FE0F, U+1F000-1FAFF;
}`;

const EMOJI_RE = /[#*0-9]\u20e3|\p{Extended_Pictographic}/u;

export const hasEmoji = (text: string) => EMOJI_RE.test(text);

/**
 * Nối ", serif, EmojiFont" vào font-family đã khai báo inline: font của email không có emoji thì
 * trình duyệt sẽ rơi xuống EmojiFont. Xử lý cả `<font face="…">` (bản gốc chỉ đọc style.fontFamily
 * nên bỏ sót thẻ <font> không có style).
 */
export function patchEmojiFonts(root: ParentNode): number {
  let patched = 0;
  for (const el of root.querySelectorAll<HTMLElement>('[style*="font-family"], font[face]')) {
    const isFontTag = el.tagName === 'FONT';
    const current = isFontTag && !el.style.fontFamily ? el.getAttribute('face') ?? '' : el.style.fontFamily;
    if (!current || current.includes('EmojiFont')) continue;
    const next = `${current}, serif, EmojiFont`;
    if (isFontTag && !el.style.fontFamily) el.setAttribute('face', next);
    else el.style.fontFamily = next;
    patched++;
  }
  return patched;
}
