/**
 * Nhấn giữ để mở context menu trên màn hình cảm ứng
 * (ý tưởng từ hooks/useContextMenuHandlers.ts của Telegram Web A).
 *
 * - Chạm xuống thì hẹn giờ 250ms; nhấc tay, huỷ chạm hoặc kéo đi thì huỷ hẹn.
 * - Đủ 250ms thì mở menu tại điểm chạm, rồi NUỐT cú "click" sinh ra khi nhấc tay
 *   (nếu không, nhấc tay xong lại mở luôn tin nhắn/chat bên dưới menu).
 *
 * Khác bản gốc: dùng Pointer Events (một đường cho cả chạm lẫn bút), cho phép rung tay
 * trong `moveTolerance` px thay vì huỷ ngay ở `touchmove` đầu tiên, và chặn `contextmenu`
 * gốc của trình duyệt để menu không mở hai lần.
 */

export interface LongPressOptions {
  /** thời gian giữ, Telegram dùng 250ms */
  delay?: number;
  /** rung tay trong phạm vi này (px) vẫn tính là đang giữ; bản gốc là 0 */
  moveTolerance?: number;
  /** chỉ áp dụng cho các loại con trỏ này, mặc định chạm và bút */
  pointerTypes?: string[];
  onLongPress: (point: { x: number; y: number; target: EventTarget | null }) => void;
  /** gọi khi một lần giữ bị huỷ, kèm lý do (để demo/log) */
  onCancel?: (reason: 'move' | 'up' | 'cancel') => void;
}

export function attachLongPress(element: HTMLElement, options: LongPressOptions) {
  const { delay = 250, moveTolerance = 10, pointerTypes = ['touch', 'pen'], onLongPress, onCancel } = options;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let start: { x: number; y: number; id: number } | undefined;
  let fired = false;

  const clear = (reason?: 'move' | 'up' | 'cancel') => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
      if (reason) onCancel?.(reason);
    }
    start = undefined;
  };

  const onPointerDown = (event: PointerEvent) => {
    // lần giữ trước mở menu nhưng không sinh click (vd. kéo tay ra ngoài rồi mới nhấc):
    // cờ cũ không được nuốt nhầm cú click mới
    fired = false;
    if (!pointerTypes.includes(event.pointerType) || !event.isPrimary) return;
    clear();
    start = { x: event.clientX, y: event.clientY, id: event.pointerId };
    const target = event.target;
    timer = setTimeout(() => {
      timer = undefined;
      fired = true;
      onLongPress({ x: start!.x, y: start!.y, target });
    }, delay);
  };

  const onPointerMove = (event: PointerEvent) => {
    if (!start || event.pointerId !== start.id) return;
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > moveTolerance) clear('move');
  };

  const onPointerUp = (event: PointerEvent) => {
    if (start && event.pointerId === start.id) clear('up');
  };
  const onPointerCancel = (event: PointerEvent) => {
    // trình duyệt bắt đầu cuộn trang: không còn là nhấn giữ nữa
    if (start && event.pointerId === start.id) clear('cancel');
  };

  // Nuốt click ngay sau một lần nhấn giữ đã mở menu (pha capture: chặn trước mọi handler con)
  const onClickCapture = (event: MouseEvent) => {
    if (!fired) return;
    fired = false;
    event.preventDefault();
    event.stopPropagation();
  };

  // Android/Chrome tự bắn `contextmenu` khi giữ lâu (~500ms+): menu của mình đã mở rồi thì chặn
  const onContextMenu = (event: MouseEvent) => {
    if (fired || timer !== undefined) event.preventDefault();
  };

  element.addEventListener('pointerdown', onPointerDown);
  element.addEventListener('pointermove', onPointerMove);
  element.addEventListener('pointerup', onPointerUp);
  element.addEventListener('pointercancel', onPointerCancel);
  element.addEventListener('click', onClickCapture, true);
  element.addEventListener('contextmenu', onContextMenu);

  return () => {
    clear();
    element.removeEventListener('pointerdown', onPointerDown);
    element.removeEventListener('pointermove', onPointerMove);
    element.removeEventListener('pointerup', onPointerUp);
    element.removeEventListener('pointercancel', onPointerCancel);
    element.removeEventListener('click', onClickCapture, true);
    element.removeEventListener('contextmenu', onContextMenu);
  };
}
