/**
 * Ba mẹo cuộn nhỏ từ Telegram Web A:
 * 1. Nhãn ngày "dính" chỉ hiện khi đang cuộn (components/middle/hooks/useStickyDates.ts)
 * 2. Khoá cuộn trong lúc chuyển tab mà layout không xô (components/right/hooks/useTransitionFixes.ts)
 * 3. Dừng quán tính cuộn trên iOS trước khi gán scrollTop (util/resetScroll.ts)
 */

// ---------------------------------------------------------------- 1. nhãn ngày dính

export interface StickyDatesOptions {
  /** phần tử nhãn ngày, CSS cho nó `position: sticky; top: …` */
  selector?: string;
  /** đứng yên bao lâu thì ẩn nhãn đang dính, Telegram dùng 1000ms */
  idleMs?: number;
  /** nhãn coi là "đang dính" nếu cách đỉnh khung ≤ giá trị này (10px, 60px khi có thanh công cụ) */
  stickyTop?: number;
  /** class gắn lên `container` khi đang cuộn (Telegram gắn `is-scrolling-messages` lên body) */
  scrollingClass?: string;
}

/**
 * Gọi ở mỗi sự kiện scroll của `container`. Khi cuộn: nhãn ngày hiện bình thường.
 * Đứng yên `idleMs`: nhãn đang dính ở đỉnh được gắn `.stuck` (CSS cho mờ đi) để không che tin nhắn.
 */
export function createStickyDates(container: HTMLElement, opts: StickyDatesOptions = {}) {
  const { selector = '.sticky-date', idleMs = 1000, stickyTop = 10, scrollingClass = 'is-scrolling' } = opts;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const findStuck = () => {
    const top = container.getBoundingClientRect().top;
    return Array.from(container.querySelectorAll<HTMLElement>(selector)).find((el) => {
      const r = el.getBoundingClientRect();
      const offset = r.top - top;
      return -r.height <= offset && offset <= stickyTop;
    });
  };

  const onScroll = () => {
    if (!container.classList.contains(scrollingClass)) {
      requestAnimationFrame(() => container.classList.add(scrollingClass));
    }
    clearTimeout(timer);
    timer = setTimeout(() => {
      requestAnimationFrame(() => {
        // chỉ tìm trong container này (bản gốc dùng document.querySelector('.stuck'), trúng cả list khác)
        container.querySelector(`${selector}.stuck`)?.classList.remove('stuck');
        findStuck()?.classList.add('stuck');
        container.classList.remove(scrollingClass);
      });
    }, idleMs);
  };

  container.addEventListener('scroll', onScroll, { passive: true });
  return () => {
    clearTimeout(timer);
    container.removeEventListener('scroll', onScroll);
  };
}

// ---------------------------------------------------------------- 2. khoá cuộn khi chuyển tab

/**
 * Trong lúc animation chuyển tab: tắt cuộn để nội dung không giật, và bù đúng bề rộng
 * thanh cuộn vừa mất bằng `margin-right` để layout không xô sang phải.
 */
export function lockScrollForTransition(container: HTMLElement) {
  if (container.dataset.scrollLocked) return () => {};
  const prevOverflow = container.style.overflowY;
  const prevMargin = container.style.marginRight;
  // offsetWidth - clientWidth gồm cả viền; trừ viền ra để còn đúng bề rộng thanh cuộn
  const cs = getComputedStyle(container);
  const scrollbarWidth =
    container.offsetWidth - container.clientWidth - parseFloat(cs.borderLeftWidth) - parseFloat(cs.borderRightWidth);
  container.dataset.scrollLocked = '1';
  container.style.overflowY = 'hidden';
  container.style.marginRight = `${scrollbarWidth}px`;
  // Trả lại đúng giá trị cũ. Bản gốc ép `overflowY = 'scroll'`, nên sau lần đầu
  // thanh cuộn luôn hiện kể cả khi nội dung ngắn.
  return () => {
    container.style.overflowY = prevOverflow;
    container.style.marginRight = prevMargin;
    delete container.dataset.scrollLocked;
  };
}

/**
 * Đặt `min-height` cho vùng nội dung tab = chiều cao khung - thanh tab.
 * Đổi từ tab dài sang tab ngắn thì khung không bị co lại, scrollTop không tụt.
 */
export function keepTabMinHeight(container: HTMLElement, content: HTMLElement, tabs: HTMLElement) {
  const update = () => {
    content.style.minHeight = `${container.offsetHeight - tabs.offsetHeight}px`;
  };
  update();
  const ro = new ResizeObserver(update);
  ro.observe(container);
  return () => ro.disconnect();
}

// ---------------------------------------------------------------- 3. dừng quán tính iOS

export const IS_IOS =
  typeof navigator !== 'undefined' &&
  (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

/**
 * Trên iOS, gán scrollTop trong lúc còn quán tính thì cú vuốt dang dở ghi đè lại.
 * Tắt overflow một nhịp làm Safari dừng quán tính, rồi bật lại.
 */
export function resetScroll(container: HTMLElement, scrollTop?: number, isIOS = IS_IOS) {
  if (isIOS) container.style.overflow = 'hidden';
  if (scrollTop !== undefined) container.scrollTop = scrollTop;
  if (isIOS) container.style.overflow = '';
}
