import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { useContextualLayer, type Align, type Position } from './contextualLayer';

/**
 * Tooltip "ấm" theo nhóm + hovercard, theo BaseTooltip / BaseTooltipGroup / useBaseHovercardTrigger.
 */

export const SHOW_DELAY = 300;
export const HIDE_DELAY = 50;

/** setState có hẹn giờ: gọi lại sẽ huỷ lần hẹn trước (giống useDelayedState của Facebook). */
export function useDelayedState<T>(initial: T) {
  const [value, setValue] = useState(initial);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => clearTimeout(timer.current ?? undefined), []);
  const setDelayed = useCallback((next: T, delay = 0) => {
    clearTimeout(timer.current ?? undefined);
    timer.current = null;
    if (delay === 0) setValue(next);
    else timer.current = setTimeout(() => setValue(next), delay);
  }, []);
  return [value, setDelayed] as const;
}

/**
 * WCAG 1.4.13 (Content on Hover or Focus): nội dung hiện khi hover/focus phải TẮT được mà
 * không cần dời chuột/focus, thường bằng Esc. Hover bằng chuột thì focus đang ở chỗ khác,
 * nên phải nghe Esc ở cấp document trong lúc layer đang hiện, không chỉ trên trigger.
 */
export function useEscapeToDismiss(visible: boolean, onDismiss: () => void) {
  const onDismissRef = useRef(onDismiss);
  useEffect(() => {
    onDismissRef.current = onDismiss;
  });
  useEffect(() => {
    if (!visible) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.isComposing || e.defaultPrevented) return;
      onDismissRef.current();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [visible]);
}

/** Layer nổi: portal ra body + định vị bằng useContextualLayer. */
export function FloatingLayer({
  anchorRef,
  position = 'above',
  align = 'middle',
  className,
  layerRef: externalRef,
  children,
}: {
  anchorRef: RefObject<Element | null>;
  position?: Position;
  align?: Align;
  className?: string;
  layerRef?: RefObject<HTMLDivElement | null>;
  children: ReactNode;
}) {
  const innerRef = useRef<HTMLDivElement>(null);
  const layerRef = externalRef ?? innerRef;
  const layer = useContextualLayer(anchorRef, layerRef, { position, align });
  return createPortal(
    <div
      ref={layerRef}
      className={className}
      data-position={layer.position}
      style={{ position: 'absolute', top: 0, left: 0, zIndex: 10 }}
    >
      {children}
    </div>,
    document.body,
  );
}

// ---------------- Tooltip group ----------------

interface ActiveTooltip {
  key: string;
  content: ReactNode;
  anchorRef: RefObject<HTMLElement | null>;
}

interface GroupContextValue {
  activeKey: string | null;
  tooltipId: string;
  show: (item: ActiveTooltip) => void;
  hide: () => void;
}

const GroupContext = createContext<GroupContextValue | null>(null);

/**
 * Cả nhóm dùng CHUNG một tooltip. Rê từ icon này sang icon kia:
 * - mouseleave icon A -> hẹn ẩn sau 50ms
 * - mouseenter icon B -> đổi nội dung NGAY + hẹn hiện sau 300ms, huỷ lệnh ẩn ở trên
 *   => tooltip đang hiện vẫn hiện, chỉ nhảy sang icon B, không phải chờ lại 300ms.
 */
export function TooltipGroup({ children, className }: { children: ReactNode; className?: string }) {
  const [visible, setVisible] = useDelayedState(false);
  const [active, setActive] = useState<ActiveTooltip | null>(null);
  const tooltipId = useId();

  const value = useMemo<GroupContextValue>(
    () => ({
      activeKey: active?.key ?? null,
      tooltipId,
      show: (item) => {
        setActive(item);
        setVisible(true, SHOW_DELAY);
      },
      hide: () => setVisible(false, HIDE_DELAY),
    }),
    [active?.key, tooltipId, setVisible],
  );
  useEscapeToDismiss(visible, () => setVisible(false));

  return (
    <GroupContext.Provider value={value}>
      {children}
      {active && (
        <TooltipBubble id={tooltipId} anchorRef={active.anchorRef} visible={visible} className={className}>
          {active.content}
        </TooltipBubble>
      )}
    </GroupContext.Provider>
  );
}

function TooltipBubble({
  id,
  anchorRef,
  visible,
  className = 'fb-tooltip',
  children,
}: {
  id: string;
  anchorRef: RefObject<HTMLElement | null>;
  visible: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <FloatingLayer anchorRef={anchorRef} position='above' align='middle'>
      {/* pointer-events: none -> tooltip không bao giờ "chặn" chuột khỏi target bên dưới */}
      <div
        id={id}
        role='tooltip'
        className={`${className}${visible ? ' is-visible' : ''}`}
        style={{ pointerEvents: 'none' }}
      >
        {children}
      </div>
    </FloatingLayer>
  );
}

/**
 * Bọc một target. Trong TooltipGroup thì dùng tooltip chung, không thì tự có tooltip riêng.
 * Bàn phím: chỉ hiện khi focus VÀ focus-visible (click chuột không bật tooltip).
 */
export function Tooltip({ content, children }: { content: ReactNode; children: ReactNode }) {
  const group = useContext(GroupContext);
  return group ? (
    <GroupedTarget group={group} content={content}>
      {children}
    </GroupedTarget>
  ) : (
    <StandaloneTooltip content={content}>{children}</StandaloneTooltip>
  );
}

function useTargetHandlers(onShow: () => void, onHide: () => void) {
  // "focus && focusVisible" như BaseTooltipTargetWrapper; dùng :focus-visible có sẵn của trình duyệt
  const onFocus = (e: FocusEvent<HTMLElement>) => {
    if ((e.target as HTMLElement).matches(':focus-visible')) onShow();
  };
  return {
    onMouseEnter: onShow,
    onMouseLeave: onHide,
    // nhấn chuột vào target (vd: bấm nút) thì ẩn tooltip đi cho đỡ vướng
    onMouseUp: onHide,
    onFocus,
    onBlur: onHide,
  };
}

function GroupedTarget({
  group,
  content,
  children,
}: {
  group: GroupContextValue;
  content: ReactNode;
  children: ReactNode;
}) {
  const key = useId();
  const ref = useRef<HTMLSpanElement>(null);
  const handlers = useTargetHandlers(
    () => group.show({ key, content, anchorRef: ref }),
    group.hide,
  );
  return (
    <span
      ref={ref}
      className='fb-tooltip-target'
      // chỉ target ĐANG active mới trỏ tới tooltip, các target khác không "mô tả" bằng
      // nội dung của icon khác
      aria-describedby={group.activeKey === key ? group.tooltipId : undefined}
      {...handlers}
    >
      {children}
    </span>
  );
}

function StandaloneTooltip({ content, children }: { content: ReactNode; children: ReactNode }) {
  const [visible, setVisible] = useDelayedState(false);
  const [mounted, setMounted] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const id = useId();
  const handlers = useTargetHandlers(
    () => {
      setMounted(true);
      setVisible(true, SHOW_DELAY);
    },
    () => setVisible(false),
  );
  useEscapeToDismiss(visible, () => setVisible(false));
  return (
    <>
      <span ref={ref} className='fb-tooltip-target' aria-describedby={visible ? id : undefined} {...handlers}>
        {children}
      </span>
      {mounted && (
        <TooltipBubble id={id} anchorRef={ref} visible={visible}>
          {content}
        </TooltipBubble>
      )}
    </>
  );
}

// ---------------- Hovercard ----------------

/**
 * Hovercard KHÔNG bị đóng khi rê chuột từ trigger sang card, dù card nằm trong portal ở
 * cuối <body>: card được render là con React của <span> bọc trigger, mà sự kiện tổng hợp
 * của React (kể cả mouseenter/mouseleave) đi theo CÂY REACT chứ không theo cây DOM.
 */
export function Hovercard({
  card,
  children,
  onLoad,
  className = 'fb-hovercard',
}: {
  card: ReactNode;
  children: ReactNode;
  /** gọi ngay khi chuột vừa vào trigger: bắt đầu tải data trong lúc chờ 300ms */
  onLoad?: () => void;
  className?: string;
}) {
  const [hoverVisible, setHoverVisible] = useDelayedState(false);
  const [touchVisible, setTouchVisible] = useState(false);
  const [focusVisible, setFocusVisible] = useState(false);
  const [mounted, setMounted] = useState(false);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const visible = hoverVisible || touchVisible || focusVisible;
  const dismiss = () => {
    setFocusVisible(false);
    setTouchVisible(false);
    setHoverVisible(false);
  };
  // Esc ở bất cứ đâu cũng tắt (kể cả khi card mở bằng hover, focus đang ở chỗ khác)
  useEscapeToDismiss(visible, dismiss);

  return (
    <span
      style={{ display: 'inline-block' }}
      onMouseEnter={() => {
        setMounted(true);
        onLoad?.();
        setHoverVisible(true, SHOW_DELAY);
      }}
      onMouseLeave={() => setHoverVisible(false, HIDE_DELAY)}
      onTouchStart={() => {
        setMounted(true);
        onLoad?.();
        setTouchVisible(true);
      }}
      onFocus={(e) => {
        if ((e.target as HTMLElement).matches(':focus-visible')) {
          setMounted(true);
          setFocusVisible(true);
        }
      }}
      onBlur={() => setFocusVisible(false)}
    >
      <span ref={anchorRef}>{children}</span>
      {mounted && (
        <FloatingLayer anchorRef={anchorRef} position='below' align='start'>
          <div
            className={`${className}${visible ? ' is-visible' : ''}`}
            // đang mờ dần thì không bắt chuột, tránh "chặn" thứ bên dưới
            style={{ pointerEvents: visible ? undefined : 'none' }}
            onClick={() => setTouchVisible(false)}
          >
            {card}
          </div>
        </FloatingLayer>
      )}
    </span>
  );
}
