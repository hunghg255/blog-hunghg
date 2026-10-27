/**
 * Kéo-thả trên lịch (ý tưởng từ calendar-view của Pipedrive: utils/dragster.js + utils/grid.js).
 *
 * - makeDraggable: phân biệt click và kéo bằng ngưỡng, nuốt cú click sinh ra sau khi kéo,
 *   tự cuộn khi kéo gần mép (chạy theo requestAnimationFrame, không phụ thuộc chuột còn di
 *   chuyển hay không), Esc để huỷ, dùng Pointer Events + pointer capture.
 * - dropTarget: tìm vùng thả dưới con trỏ bằng elementFromPoint + closest, quy đổi toạ độ.
 * - snap: hút về lưới (15 phút).
 * - slotToUtc: đổi "ngày + phút trên lưới" thành thời điểm UTC theo giờ đồng hồ treo tường
 *   của một múi giờ, nên không lệch 1 tiếng trong ngày đổi giờ mùa hè.
 */

export interface DragOptions {
  /** phải đi quá bao nhiêu px (theo trục bất kỳ) mới tính là kéo, mặc định 6 */
  threshold?: number;
  onStart?: (event: PointerEvent) => void;
  /** gọi khi chuột di chuyển VÀ khi vùng cuộn tự cuộn (nội dung dưới con trỏ đã đổi) */
  onMove?: (event: PointerEvent) => void;
  onEnd?: (event: PointerEvent) => void;
  /** Esc, pointercancel (vd trình duyệt giành cử chỉ cuộn trên cảm ứng) */
  onCancel?: () => void;
  /** vùng cuộn để tự cuộn khi kéo gần mép */
  scrollContainer?: HTMLElement | null | (() => HTMLElement | null);
  /** độ dày vùng mép, tính theo phần chiều cao vùng cuộn, mặc định 0.15 */
  edge?: number;
  /** tốc độ cuộn tối đa, px mỗi frame, mặc định 16 */
  maxSpeed?: number;
}

/** Gắn hành vi kéo cho một phần tử. Trả về hàm gỡ. Phần tử nên có CSS `touch-action: none`. */
export function makeDraggable(element: HTMLElement, options: DragOptions = {}): () => void {
  const { threshold = 6, edge = 0.15, maxSpeed = 16 } = options;
  let pointerId: number | null = null;
  let origin = { x: 0, y: 0 };
  let dragging = false;
  let lastEvent: PointerEvent | null = null;
  let frame = 0;

  const container = () =>
    typeof options.scrollContainer === 'function' ? options.scrollContainer() : options.scrollContainer ?? null;

  // Cuộn theo frame: Pipedrive chỉ cuộn trong pointermove, nên giữ chuột yên ở mép thì
  // lịch ngừng cuộn. Ở đây tốc độ tăng dần theo độ sâu con trỏ đi vào vùng mép.
  const autoScroll = () => {
    frame = 0;
    const box = container();
    if (!dragging || !box || !lastEvent) return;
    const rect = box.getBoundingClientRect();
    const zone = rect.height * edge;
    const y = lastEvent.clientY;
    let speed = 0;
    if (y < rect.top + zone) speed = -maxSpeed * Math.min(1, (rect.top + zone - y) / zone);
    else if (y > rect.bottom - zone) speed = maxSpeed * Math.min(1, (y - (rect.bottom - zone)) / zone);
    if (speed !== 0) {
      const before = box.scrollTop;
      box.scrollTop += speed;
      // nội dung dưới con trỏ đổi dù chuột đứng yên: báo lại để cập nhật bản xem trước
      if (box.scrollTop !== before) options.onMove?.(lastEvent);
    }
    frame = requestAnimationFrame(autoScroll);
  };

  // Sau khi kéo, nhả chuột vẫn sinh ra một sự kiện click trên phần tử. Nuốt đúng cú click đó
  // (pha capture trên window), rồi gỡ ở tick sau phòng khi trình duyệt không phát click.
  const swallowNextClick = () => {
    const swallow = (e: MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
    };
    window.addEventListener('click', swallow, { capture: true, once: true });
    setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
  };

  const cleanup = () => {
    if (pointerId !== null && element.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId);
    pointerId = null;
    dragging = false;
    lastEvent = null;
    cancelAnimationFrame(frame);
    frame = 0;
    element.removeEventListener('pointermove', onPointerMove);
    element.removeEventListener('pointerup', onPointerUp);
    element.removeEventListener('pointercancel', onPointerCancel);
    window.removeEventListener('keydown', onKeyDown, true);
  };

  const onPointerDown = (event: PointerEvent) => {
    if (!event.isPrimary || event.button !== 0 || pointerId !== null) return;
    pointerId = event.pointerId;
    origin = { x: event.clientX, y: event.clientY };
    // pointer capture: mọi pointermove/pointerup gửi về phần tử này kể cả khi con trỏ ra
    // ngoài phần tử hay ra ngoài cửa sổ, nên không bao giờ "kẹt" ở trạng thái đang kéo
    element.setPointerCapture(event.pointerId);
    element.addEventListener('pointermove', onPointerMove);
    element.addEventListener('pointerup', onPointerUp);
    element.addEventListener('pointercancel', onPointerCancel);
  };

  const onPointerMove = (event: PointerEvent) => {
    if (event.pointerId !== pointerId) return;
    lastEvent = event;
    if (!dragging) {
      const dx = Math.abs(event.clientX - origin.x);
      const dy = Math.abs(event.clientY - origin.y);
      if (dx < threshold && dy < threshold) return; // vẫn là click
      dragging = true;
      window.addEventListener('keydown', onKeyDown, true);
      options.onStart?.(event);
      frame = requestAnimationFrame(autoScroll);
    }
    options.onMove?.(event);
  };

  const onPointerUp = (event: PointerEvent) => {
    if (event.pointerId !== pointerId) return;
    const wasDragging = dragging;
    cleanup();
    if (wasDragging) {
      swallowNextClick();
      options.onEnd?.(event);
    }
  };

  const onPointerCancel = (event: PointerEvent) => {
    if (event.pointerId !== pointerId) return;
    const wasDragging = dragging;
    cleanup();
    if (wasDragging) options.onCancel?.();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || !dragging) return;
    event.preventDefault();
    event.stopPropagation();
    cleanup();
    swallowNextClick();
    options.onCancel?.();
  };

  element.addEventListener('pointerdown', onPointerDown);
  return () => {
    cleanup();
    element.removeEventListener('pointerdown', onPointerDown);
  };
}

// ---------- lưới ----------

export const snap = (value: number, step: number) => Math.round(value / step) * step;

export interface DropTarget {
  name: string;
  element: HTMLElement;
  /** toạ độ con trỏ tính trong NỘI DUNG vùng thả (đã cộng phần đã cuộn của vùng) */
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Vùng thả dưới con trỏ. Bản xem trước đang kéo phải có `pointer-events: none`, nếu không
 * elementFromPoint sẽ trả về chính nó.
 */
export function dropTarget(clientX: number, clientY: number, attr = 'data-drop-area'): DropTarget | null {
  const hit = document.elementFromPoint(clientX, clientY);
  const area = hit?.closest<HTMLElement>(`[${attr}]`);
  if (!area) return null;
  const rect = area.getBoundingClientRect();
  return {
    name: area.getAttribute(attr) ?? '',
    element: area,
    // clientX và rect đều tính theo viewport: KHÔNG cộng thêm window.scrollX/Y
    x: clientX - rect.left + area.scrollLeft,
    y: clientY - rect.top + area.scrollTop,
    width: area.clientWidth,
    height: area.clientHeight,
  };
}

// ---------- giờ theo múi giờ ----------

export interface CalendarDay {
  year: number;
  /** 1-12 */
  month: number;
  day: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function partsFormatter(timeZone: string) {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/** Giờ đồng hồ treo tường ở múi giờ `timeZone` tại thời điểm `utcMs`. */
export function wallClock(utcMs: number, timeZone: string) {
  const parts: Record<string, number> = {};
  for (const p of partsFormatter(timeZone).formatToParts(utcMs)) if (p.type !== 'literal') parts[p.type] = Number(p.value);
  return { year: parts.year, month: parts.month, day: parts.day, hour: parts.hour, minute: parts.minute, second: parts.second };
}

/** Độ lệch (phút) của múi giờ so với UTC tại thời điểm `utcMs`, vd Berlin mùa hè = +120. */
export function zoneOffsetMinutes(utcMs: number, timeZone: string): number {
  const w = wallClock(utcMs, timeZone);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return Math.round((asUtc - Math.floor(utcMs / 1000) * 1000) / 60000);
}

/**
 * Giờ treo tường -> UTC. Mỗi ngày đổi giờ chỉ có hai độ lệch: trước và sau lúc chuyển. Lấy độ
 * lệch ở 12 tiếng trước và 12 tiếng sau, thử cả hai, giữ ứng viên nào cho ra đúng giờ treo
 * tường đã yêu cầu.
 * - Giờ lặp lại (02:30 ngày lùi giờ): cả hai đều đúng, chọn lần xuất hiện thứ nhất (sớm hơn).
 * - Giờ không tồn tại (02:30 ngày tiến giờ): không ứng viên nào đúng, dùng độ lệch trước lúc
 *   chuyển, tức là đẩy về sau (02:30 thành 03:30), giống chế độ "compatible" của Temporal.
 */
export function wallToUtc(day: CalendarDay, minutes: number, timeZone: string): number {
  const naive = Date.UTC(day.year, day.month - 1, day.day, 0, minutes);
  const before = naive - zoneOffsetMinutes(naive - 12 * 3_600_000, timeZone) * 60000;
  const after = naive - zoneOffsetMinutes(naive + 12 * 3_600_000, timeZone) * 60000;
  const matches = (utc: number) => {
    const w = wallClock(utc, timeZone);
    return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute) === naive;
  };
  const valid = [before, after].filter(matches);
  return valid.length > 0 ? Math.min(...valid) : before;
}

/** Cách Pipedrive làm nếu KHÔNG có đoạn bù DST: nửa đêm + số phút (thời gian trôi thật). */
export function slotToUtcNaive(day: CalendarDay, minutes: number, timeZone: string): number {
  return wallToUtc(day, 0, timeZone) + minutes * 60000;
}

/** Ô lịch -> UTC theo giờ treo tường: thả ở ô 10:00 thì sự kiện là 10:00, kể cả ngày đổi giờ. */
export function slotToUtc(day: CalendarDay, minutes: number, timeZone: string): number {
  return wallToUtc(day, minutes, timeZone);
}

/** Số giờ thật của một ngày ở múi giờ đó (23, 24 hoặc 25). */
export function hoursInDay(day: CalendarDay, timeZone: string): number {
  const start = wallToUtc(day, 0, timeZone);
  const next = new Date(Date.UTC(day.year, day.month - 1, day.day + 1));
  const end = wallToUtc({ year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate() }, 0, timeZone);
  return (end - start) / 3_600_000;
}
