import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import './tgTransition.css';

/**
 * Ba mẹo chuyển cảnh của Telegram Web:
 * 1. calcMorphScales: ô soạn tin "biến hình" thành thanh chọn tin bằng scaleX tính trước, không đo DOM.
 * 2. Transition: giữ màn cũ để chạy animation ra/vào, gắn class from/to, đợi animationend.
 * 3. useSlidingIndicator: gạch chân tab bay từ tab cũ sang tab mới (FLIP).
 */

// ---------- 1. Biến hình bằng scaleX ----------

export interface MorphInput {
  /** bề rộng vùng chứa (danh sách tin) */
  containerWidth: number;
  /** padding hai bên của footer */
  sidePadding: number;
  /** nút gửi bên phải ô soạn tin; 0 nếu không được gửi tin */
  sendButtonWidth: number;
  /** bề rộng tối đa của thanh chọn tin */
  maxToolbarWidth: number;
}

/**
 * Ô soạn tin và thanh chọn tin nằm chồng lên nhau. Khi đổi qua lại, cái đang hiện co/giãn theo
 * chiều ngang tới đúng bề rộng của cái kia rồi mờ đi, cái kia làm ngược lại: nhìn như MỘT khung
 * đang biến hình. Mọi con số đều tính từ bề rộng vùng chứa, lúc bấm không phải đo phần tử nào.
 */
export function calcMorphScales({ containerWidth, sidePadding, sendButtonWidth, maxToolbarWidth }: MorphInput) {
  const composerWidth = containerWidth - sidePadding - sendButtonWidth;
  const toolbarWidth = Math.min(containerWidth - sidePadding, maxToolbarWidth);
  const composerHiddenScale = toolbarWidth / composerWidth;
  const toolbarHiddenScale = composerWidth / toolbarWidth;
  return {
    composerWidth,
    toolbarWidth,
    composerHiddenScale,
    toolbarHiddenScale,
    // ô soạn tin lệch trái nửa nút gửi so với thanh chọn tin (căn giữa); dịch bù lại.
    // Đơn vị đo TRƯỚC khi scale nên phải nhân với nghịch đảo tỉ lệ
    composerTranslateX: sendButtonWidth ? (sendButtonWidth / 2) * toolbarHiddenScale : 0,
    toolbarTranslateX: sendButtonWidth ? -(sendButtonWidth / 2) * composerHiddenScale : 0,
  };
}

export function morphVars(input: MorphInput): CSSProperties {
  const m = calcMorphScales(input);
  return {
    '--composer-hidden-scale': m.composerHiddenScale,
    '--toolbar-hidden-scale': m.toolbarHiddenScale,
    '--composer-translate-x': `${m.composerTranslateX}px`,
    '--toolbar-translate-x': `${m.toolbarTranslateX}px`,
  } as CSSProperties;
}

// ---------- 2. Transition ----------

export type TransitionName = 'slide' | 'slide-fade' | 'zoom-fade' | 'reveal';

export interface TransitionProps {
  activeKey: number;
  name?: TransitionName;
  /** 'auto': key lớn hơn là đi tới; 'inverse': ngược lại */
  direction?: 'auto' | 'inverse' | 1 | -1;
  /** chờ animationend tối đa bao lâu (ms) rồi coi như xong */
  timeoutMs?: number;
  /**
   * Chỉ để demo: chờ animationend như bản gốc (không có hạn chờ). Màn mới không có animation
   * thì không bao giờ có animationend, Transition kẹt ở trạng thái đang chạy.
   */
  legacyWait?: boolean;
  className?: string;
  onStart?: () => void;
  onStop?: () => void;
  children: (key: number) => ReactNode;
}

const prefersReducedMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export function Transition({
  activeKey,
  name = 'slide',
  direction = 'auto',
  timeoutMs = 700,
  legacyWait = false,
  className,
  onStart,
  onStop,
  children,
}: TransitionProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // Lưu hàm render của từng key: màn cũ phải tiếp tục render trong lúc chạy animation ra.
  // Ghi ref trong lúc render là ngoại lệ có chủ ý: idempotent, render lại bao nhiêu lần cũng vậy.
  const rendersRef = useRef(new Map<number, (key: number) => ReactNode>());
  rendersRef.current.set(activeKey, children);

  // fromKey: màn đang rời đi (undefined khi không có animation)
  const [state, setState] = useState<{ shownKey: number; fromKey?: number }>({ shownKey: activeKey });
  if (state.shownKey !== activeKey) {
    // "cập nhật state theo prop trong lúc render" (mẫu React khuyên dùng thay cho useEffect)
    setState({ shownKey: activeKey, fromKey: state.shownKey });
  }
  const { fromKey } = state;

  const callbacksRef = useRef({ onStart, onStop });
  callbacksRef.current = { onStart, onStop };

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container || fromKey === undefined) return;

    const finish = () => {
      container.classList.remove('animating', 'backwards');
      // bỏ hàm render của màn cũ để nó unmount
      for (const key of [...rendersRef.current.keys()]) if (key !== activeKey) rendersRef.current.delete(key);
      setState((s) => (s.shownKey === activeKey ? { shownKey: activeKey } : s));
      callbacksRef.current.onStop?.();
    };

    if (prefersReducedMotion()) {
      finish();
      return;
    }

    const isBackwards =
      direction === -1 ||
      (direction === 'auto' && fromKey > activeKey) ||
      (direction === 'inverse' && fromKey < activeKey);
    container.classList.remove('animating');
    container.classList.toggle('backwards', isBackwards);

    const toNode = container.querySelector<HTMLElement>(':scope > .to');
    let raf = requestAnimationFrame(() => {
      // frame sau mới bật animation: frame này để trình duyệt vẽ vị trí bắt đầu (.from/.to)
      container.classList.add('animating');
      callbacksRef.current.onStart?.();
    });

    let done = false;
    let timer: number | undefined;
    const onEnd = (event: AnimationEvent) => {
      // animationend của phần tử con nổi bọt lên: chỉ tính của chính màn mới
      if (done || event.target !== event.currentTarget) return;
      done = true;
      raf = requestAnimationFrame(finish);
    };
    toNode?.addEventListener('animationend', onEnd);
    if (!legacyWait) {
      timer = window.setTimeout(() => {
        if (done) return;
        done = true;
        finish();
      }, timeoutMs);
    }

    return () => {
      // đổi activeKey giữa chừng: bỏ animation dở, effect mới chạy từ màn hiện tại
      cancelAnimationFrame(raf);
      clearTimeout(timer);
      toNode?.removeEventListener('animationend', onEnd);
    };
  }, [activeKey, fromKey, direction, legacyWait, timeoutMs]);

  const keys = fromKey === undefined ? [activeKey] : [fromKey, activeKey];
  return (
    <div ref={containerRef} className={['tgt', name, className].filter(Boolean).join(' ')}>
      {keys.map((key) => {
        const render = rendersRef.current.get(key);
        const role = fromKey === undefined ? 'active' : key === activeKey ? 'to' : 'from';
        return (
          <div key={key} className={role} aria-hidden={role === 'from' || undefined}>
            {render?.(key)}
          </div>
        );
      })}
    </div>
  );
}

// ---------- 3. Gạch chân tab trượt ----------

/**
 * Mỗi tab có gạch chân riêng. Khi tab mới thành active: đặt gạch chân của nó trùng vị trí và bề rộng
 * gạch chân tab cũ (translate + scaleX), ép trình duyệt tính style, rồi gỡ transform để nó tự trượt
 * và co giãn về chỗ. Chỉ dùng transform nên chạy trên compositor.
 */
export function useSlidingIndicator(listRef: React.RefObject<HTMLElement | null>, activeIndex: number) {
  const prevRef = useRef<number | undefined>(undefined);

  useLayoutEffect(() => {
    const list = listRef.current;
    const prev = prevRef.current;
    prevRef.current = activeIndex;
    if (!list || prev === undefined || prev === activeIndex) return;

    const tabs = list.querySelectorAll<HTMLElement>('[data-tab]');
    const from = tabs[prev]?.querySelector<HTMLElement>('[data-indicator]');
    const to = tabs[activeIndex]?.querySelector<HTMLElement>('[data-indicator]');
    if (!from || !to) return;

    const fromRect = from.getBoundingClientRect();
    const toRect = to.getBoundingClientRect();
    to.style.transition = 'none';
    to.style.transform = `translate3d(${fromRect.left - toRect.left}px, 0, 0) scale3d(${fromRect.width / toRect.width}, 1, 1)`;
    // đọc layout để trình duyệt "chốt" transform vừa gán; nếu không, hai lần gán bị gộp làm một
    // và không có animation. Telegram dùng 3 lần rAF (để khớp nhịp với Transition) cho cùng mục đích
    void to.offsetWidth;
    to.style.transition = '';
    to.style.transform = '';

    // tab active luôn nằm trong tầm nhìn; lệch ít thì thôi để không giật
    const tab = tabs[activeIndex];
    const listRect = list.getBoundingClientRect();
    const tabRect = tab.getBoundingClientRect();
    const offset = tabRect.left + tabRect.width / 2 - (listRect.left + listRect.width / 2);
    if (Math.abs(offset) > 16) list.scrollBy({ left: offset, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  }, [listRef, activeIndex]);
}
