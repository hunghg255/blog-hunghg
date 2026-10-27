import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * Khung cuộn cho chat (ý tưởng từ MWChatConversationScroller của Facebook Messenger):
 * - đang ở đáy thì tin mới đến vẫn dính đáy
 * - nội dung phía trên thay đổi (tải tin cũ, spinner, ảnh tải xong) thì chỗ đang đọc đứng yên
 * - chạm đỉnh -> gọi tải tin cũ; nội dung chưa lấp đầy khung -> gọi tải thêm ngay
 * - cuộn tới mép không "lan" ra trang bên ngoài (overscroll containment)
 *
 * Bí quyết: ghi lại vị trí TRƯỚC khi nội dung đổi (trong sự kiện scroll), rồi khôi phục SAU khi
 * DOM đổi nhưng TRƯỚC khi trình duyệt vẽ (useLayoutEffect / ResizeObserver).
 */

export type ChatScrollPosition =
  | { kind: 'bottom' }
  | { kind: 'top'; fromBottom: number }
  | { kind: 'middle'; fromBottom: number };

export interface UseChatScrollerOptions {
  /** vừa cuộn chạm đỉnh: tải tin cũ hơn */
  onReachTop?: () => void;
  /** vừa cuộn về đáy: đánh dấu đã đọc, tải tin mới hơn… */
  onReachBottom?: () => void;
  /** nội dung chưa đủ cao để cuộn: nên tải thêm luôn (người dùng không thể cuộn để kích hoạt) */
  onNotFilled?: () => void;
  onPositionChange?: (position: ChatScrollPosition) => void;
  /** dung sai coi là "ở đáy" / "ở đỉnh", Facebook dùng 20px */
  threshold?: number;
  /** theo dõi thay đổi kích thước không qua React (ảnh tải xong, bàn phím mobile bật lên…) */
  observeResize?: boolean;
}

export function measureChatPosition(el: HTMLElement, threshold = 20): ChatScrollPosition {
  const fromBottom = el.scrollHeight - (el.scrollTop + el.clientHeight);
  if (fromBottom <= threshold) return { kind: 'bottom' };
  if (el.scrollTop <= threshold) return { kind: 'top', fromBottom };
  return { kind: 'middle', fromBottom };
}

/** Phần tử "neo": con đầu tiên còn nhìn thấy ở mép trên khung, kèm khoảng cách tới mép trên. */
interface Anchor {
  element: Element;
  offset: number;
}

function findAnchor(scroller: HTMLElement, content: Element): Anchor | null {
  const viewportTop = scroller.getBoundingClientRect().top;
  const children = content.children;
  // Tìm nhị phân con đầu tiên có đáy nằm dưới mép trên khung: O(log n) lần đo.
  let lo = 0;
  let hi = children.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (children[mid].getBoundingClientRect().bottom > viewportTop) {
      found = mid;
      hi = mid - 1;
    } else {
      lo = mid + 1;
    }
  }
  if (found === -1) return null;
  const element = children[found];
  return { element, offset: element.getBoundingClientRect().top - viewportTop };
}

const supportsOverscrollBehavior =
  typeof CSS !== 'undefined' && CSS.supports?.('overscroll-behavior', 'contain');

export function useChatScroller<S extends HTMLElement = HTMLDivElement, C extends HTMLElement = HTMLDivElement>(
  options: UseChatScrollerOptions = {},
) {
  const { threshold = 20, observeResize = true } = options;
  const [scroller, setScroller] = useState<S | null>(null);
  const [content, setContent] = useState<C | null>(null);
  // Chat mở ra là đang ở tin mới nhất.
  const positionRef = useRef<ChatScrollPosition>({ kind: 'bottom' });
  const anchorRef = useRef<Anchor | null>(null);

  // "latest ref" cho các callback: listener gắn 1 lần nhưng luôn gọi bản mới nhất
  const optionsRef = useRef(options);
  useLayoutEffect(() => {
    optionsRef.current = options;
  });

  const getContent = useCallback(
    () => content ?? scroller?.firstElementChild ?? null,
    [content, scroller],
  );

  /** Đặt lại scrollTop theo vị trí đã ghi nhận. Idempotent: gọi nhiều lần không sao. */
  const restore = useCallback(() => {
    if (!scroller) return;
    const pos = positionRef.current;
    if (pos.kind === 'bottom') {
      scroller.scrollTop = scroller.scrollHeight;
      return;
    }
    const anchor = anchorRef.current;
    if (anchor && anchor.element.isConnected) {
      // Neo bị đẩy xuống/kéo lên bao nhiêu thì bù scrollTop đúng bấy nhiêu.
      const viewportTop = scroller.getBoundingClientRect().top;
      const delta = anchor.element.getBoundingClientRect().top - viewportTop - anchor.offset;
      if (Math.abs(delta) >= 1) scroller.scrollTop += delta;
    } else {
      // Không còn neo (bị xoá): quay về cách của Facebook, giữ khoảng cách tới đáy.
      scroller.scrollTop = scroller.scrollHeight - (pos.fromBottom + scroller.clientHeight);
    }
  }, [scroller]);

  // Ghi nhận vị trí + neo, và bắn sự kiện khi CHUYỂN trạng thái (edge-triggered, giống Facebook):
  // nằm yên ở đỉnh không gọi tải tin cũ liên tục.
  const update = useCallback(() => {
    if (!scroller) return;
    const prev = positionRef.current;
    const next = measureChatPosition(scroller, threshold);
    positionRef.current = next;
    const contentEl = getContent();
    anchorRef.current = next.kind === 'bottom' || !contentEl ? null : findAnchor(scroller, contentEl);
    if (next.kind !== prev.kind) optionsRef.current.onPositionChange?.(next);
    if (next.kind === 'top' && prev.kind !== 'top') optionsRef.current.onReachTop?.();
    if (next.kind === 'bottom' && prev.kind !== 'bottom') optionsRef.current.onReachBottom?.();
  }, [scroller, threshold, getContent]);

  // Sau MỖI lần render (không deps): DOM đã đổi nhưng chưa vẽ -> khôi phục vị trí.
  useLayoutEffect(() => {
    if (!scroller) return;
    restore();
    if (scroller.clientHeight > 0 && Math.abs(scroller.scrollHeight - scroller.clientHeight) < threshold) {
      optionsRef.current.onNotFilled?.();
    }
  });

  useEffect(() => {
    if (!scroller) return;
    // Tắt scroll anchoring của trình duyệt: ta tự neo, để hành vi giống nhau trên mọi trình
    // duyệt (Safari không có scroll anchoring) và không bị bù hai lần.
    scroller.style.overflowAnchor = 'none';
    scroller.style.overscrollBehavior = 'contain';

    // Chỉ đọc layout (không ghi), nên chạy ở mỗi sự kiện scroll vẫn rẻ.
    scroller.addEventListener('scroll', update, { passive: true });

    // Trình duyệt cũ không có overscroll-behavior: chặn wheel ở mép bằng preventDefault.
    // Listener non-passive làm chậm cuộn, nên chỉ gắn khi chuột đang ở trên khung chat.
    const onWheel = (event: WheelEvent) => {
      const atBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= 0;
      if ((event.deltaY > 0 && atBottom) || (event.deltaY < 0 && scroller.scrollTop <= 0)) {
        event.preventDefault();
      }
    };
    const onEnter = () => scroller.addEventListener('wheel', onWheel, { passive: false });
    const onLeave = () => scroller.removeEventListener('wheel', onWheel);
    if (!supportsOverscrollBehavior) {
      scroller.addEventListener('mouseenter', onEnter);
      scroller.addEventListener('mouseleave', onLeave);
    }

    return () => {
      scroller.removeEventListener('scroll', update);
      scroller.removeEventListener('mouseenter', onEnter);
      scroller.removeEventListener('mouseleave', onLeave);
      onLeave();
    };
  }, [scroller, update]);

  // Kích thước đổi KHÔNG qua React render: ảnh/video tải xong, font tải xong, bàn phím ảo bật
  // làm khung chat thấp đi… useLayoutEffect không chạy trong các trường hợp này.
  useEffect(() => {
    if (!scroller || !observeResize || typeof ResizeObserver === 'undefined') return;
    // Callback của ResizeObserver chạy sau layout, trước paint -> sửa vị trí không bị giật.
    const observer = new ResizeObserver(() => restore());
    observer.observe(scroller);
    const contentEl = getContent();
    if (contentEl) observer.observe(contentEl);
    return () => observer.disconnect();
  }, [scroller, observeResize, restore, getContent]);

  const scrollToBottom = useCallback(() => {
    if (!scroller) return;
    positionRef.current = { kind: 'bottom' };
    anchorRef.current = null;
    scroller.scrollTop = scroller.scrollHeight;
  }, [scroller]);

  return {
    /** gắn vào phần tử có overflow-y: auto */
    scrollerRef: setScroller,
    /** gắn vào phần tử bọc trực tiếp danh sách tin nhắn (mỗi con = một tin) */
    contentRef: setContent,
    scrollToBottom,
    getPosition: () => positionRef.current,
  };
}
