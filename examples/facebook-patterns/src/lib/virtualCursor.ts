/**
 * Phân biệt một cú click đến từ đâu: chuột/ngón tay thật, bàn phím (Enter/Space),
 * "con trỏ ảo" của trình đọc màn hình, hay code gọi element.click().
 *
 * Ý tưởng từ VirtualCursorStatus / CometVirtualCursorStatus của Facebook: soi "chữ ký"
 * của MouseEvent (toạ độ, offset, cờ mousedown/mouseup trong cùng tick, thuộc tính riêng
 * của từng engine). Bản này giữ lại heuristic cũ để so sánh, nhưng ưu tiên tín hiệu chuẩn
 * hiện đại: `event.detail === 0` và `pointerType` của click.
 */

export type ClickSource = 'mouse' | 'touch' | 'pen' | 'keyboard' | 'assistive' | 'programmatic';

export interface ClickSignature {
  isTrusted: boolean;
  /** số lần bấm của chuột; click do bàn phím/trình đọc màn hình/code tạo ra có detail = 0 */
  detail: number;
  /** '' nếu click không đến từ con trỏ; undefined nếu trình duyệt chưa bắn click dạng PointerEvent */
  pointerType: string | undefined;
  clientX: number;
  clientY: number;
  offsetX: number;
  offsetY: number;
  /** có mousedown / mouseup trong cùng tick với click không */
  sawMouseDown: boolean;
  sawMouseUp: boolean;
  /** phím đang được giữ lúc click (Enter, Space…) */
  keyHeld: string | null;
  /** Firefox: 0 = MOZ_SOURCE_UNKNOWN (không phải chuột thật) */
  mozInputSource: number | undefined;
  /** Safari: lực nhấn; nhỏ hơn WEBKIT_FORCE_AT_MOUSE_DOWN nghĩa là không có cú nhấn thật */
  webkitForce: number | undefined;
  webkitForceAtMouseDown: number | undefined;
}

export interface Classification {
  source: ClickSource;
  reasons: string[];
}

/** Chuyển sự kiện + trạng thái theo dõi thành một "chữ ký" thuần dữ liệu (dễ test). */
export function readSignature(
  event: MouseEvent,
  state: { sawMouseDown: boolean; sawMouseUp: boolean; keyHeld: string | null },
): ClickSignature {
  const legacy = event as MouseEvent & {
    mozInputSource?: number;
    webkitForce?: number;
    WEBKIT_FORCE_AT_MOUSE_DOWN?: number;
  };
  const pointerType =
    typeof PointerEvent !== 'undefined' && event instanceof PointerEvent ? event.pointerType : undefined;
  return {
    isTrusted: event.isTrusted,
    detail: event.detail,
    pointerType,
    clientX: event.clientX,
    clientY: event.clientY,
    offsetX: event.offsetX,
    offsetY: event.offsetY,
    sawMouseDown: state.sawMouseDown,
    sawMouseUp: state.sawMouseUp,
    keyHeld: state.keyHeld,
    mozInputSource: legacy.mozInputSource,
    webkitForce: legacy.webkitForce,
    webkitForceAtMouseDown: legacy.WEBKIT_FORCE_AT_MOUSE_DOWN,
  };
}

/**
 * Bản port các heuristic của Facebook (bỏ nhánh IE). Trả về tên "trình duyệt bị bắt",
 * rỗng nghĩa là coi như click thật.
 */
export function legacyHeuristics(sig: ClickSignature): Set<string> {
  const hits = new Set<string>();
  const { clientX, clientY, offsetX, offsetY, sawMouseDown, sawMouseUp, isTrusted } = sig;
  const noMoz = sig.mozInputSource == null;
  if (clientX === 0 && clientY === 0 && offsetX >= 0 && offsetY >= 0 && sawMouseUp && isTrusted && noMoz) {
    hits.add('Chrome');
  }
  if (
    sawMouseDown &&
    sawMouseUp &&
    !sig.keyHeld &&
    sig.webkitForce != null &&
    sig.webkitForceAtMouseDown != null &&
    sig.webkitForce < sig.webkitForceAtMouseDown &&
    offsetX === 0 &&
    offsetY === 0 &&
    noMoz
  ) {
    hits.add('Safari-edge');
  }
  if (clientX === 0 && clientY === 0 && offsetX < 0 && offsetY < 0 && sawMouseUp && noMoz) {
    hits.add('Safari-old');
  }
  if (sig.mozInputSource === 0 && isTrusted) hits.add('Firefox');
  return hits;
}

/** Phân loại theo thứ tự tín hiệu đáng tin nhất trước. */
export function classifyClick(sig: ClickSignature): Classification {
  const reasons: string[] = [];
  if (!sig.isTrusted) {
    reasons.push('isTrusted = false: sự kiện do script tạo ra');
    return { source: 'programmatic', reasons };
  }
  if (sig.pointerType === 'mouse' || sig.pointerType === 'touch' || sig.pointerType === 'pen') {
    // click thật luôn đi sau pointerdown/pointerup; detail ≥ 1
    reasons.push(`pointerType = "${sig.pointerType}"`);
    return { source: sig.pointerType, reasons };
  }
  if (sig.keyHeld === 'Enter' || sig.keyHeld === ' ' || sig.keyHeld === 'Spacebar') {
    reasons.push(`phím "${sig.keyHeld === ' ' ? 'Space' : sig.keyHeld}" đang được giữ`);
    return { source: 'keyboard', reasons };
  }
  if (sig.detail === 0) {
    reasons.push('detail = 0: không có cú bấm chuột nào');
    if (sig.pointerType === '') reasons.push('pointerType = "": không đến từ con trỏ');
    return { source: 'assistive', reasons };
  }
  const legacy = legacyHeuristics(sig);
  if (legacy.size > 0) {
    reasons.push(`heuristic cũ của Facebook: ${[...legacy].join(', ')}`);
    return { source: 'assistive', reasons };
  }
  reasons.push(`detail = ${sig.detail}, không có pointerType: đoán là chuột`);
  return { source: 'mouse', reasons };
}

export interface ClickSourceTracker {
  /** nguồn của click gần nhất (giữ trong 1 tick, giống isVirtualCursorTriggered của FB) */
  current(): Classification | null;
  /** true nếu click vừa rồi KHÔNG đến từ con trỏ: nên chuyển focus/hiện focus ring */
  isNonPointer(): boolean;
  subscribe(listener: (result: Classification, sig: ClickSignature, event: MouseEvent) => void): () => void;
  destroy(): void;
}

/**
 * Theo dõi toàn trang ở pha capture. Cờ mousedown/mouseup chỉ sống tới tick kế tiếp:
 * trình duyệt bắn mouseup và click liền nhau trong cùng một task, còn click do trình
 * đọc màn hình hay bàn phím thì không có cặp mousedown/mouseup thật đi kèm.
 */
export function createClickSourceTracker(target: Document | HTMLElement = document): ClickSourceTracker {
  let sawMouseDown = false;
  let sawMouseUp = false;
  let keyHeld: string | null = null;
  // Space kích hoạt nút ở keyup chứ không phải keydown, nên giữ phím vừa nhả thêm 1 tick
  let keyJustReleased: string | null = null;
  let current: Classification | null = null;
  const listeners = new Set<(r: Classification, s: ClickSignature, e: MouseEvent) => void>();

  const nextTick = (fn: () => void) => setTimeout(fn, 0);

  const onKeyDown = (e: Event) => {
    keyHeld = (e as KeyboardEvent).key;
  };
  const onKeyUp = (e: Event) => {
    const key = (e as KeyboardEvent).key;
    keyHeld = null;
    keyJustReleased = key;
    nextTick(() => {
      if (keyJustReleased === key) keyJustReleased = null;
    });
  };
  // keyup có thể không tới nếu cửa sổ mất focus giữa chừng (FB cũng xoá ở blur)
  const onBlur = () => {
    keyHeld = null;
  };
  const onMouseDown = () => {
    sawMouseDown = true;
    nextTick(() => (sawMouseDown = false));
  };
  const onMouseUp = () => {
    sawMouseUp = true;
    nextTick(() => (sawMouseUp = false));
  };
  const onClick = (e: Event) => {
    const event = e as MouseEvent;
    const sig = readSignature(event, { sawMouseDown, sawMouseUp, keyHeld: keyHeld ?? keyJustReleased });
    const result = classifyClick(sig);
    current = result;
    listeners.forEach((listener) => listener(result, sig, event));
    nextTick(() => {
      if (current === result) current = null;
    });
  };

  target.addEventListener('keydown', onKeyDown, true);
  target.addEventListener('keyup', onKeyUp, true);
  target.addEventListener('mousedown', onMouseDown, true);
  target.addEventListener('mouseup', onMouseUp, true);
  target.addEventListener('click', onClick, true);
  window.addEventListener('blur', onBlur);

  return {
    current: () => current,
    isNonPointer: () => current != null && current.source !== 'mouse' && current.source !== 'touch' && current.source !== 'pen',
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    destroy() {
      target.removeEventListener('keydown', onKeyDown, true);
      target.removeEventListener('keyup', onKeyUp, true);
      target.removeEventListener('mousedown', onMouseDown, true);
      target.removeEventListener('mouseup', onMouseUp, true);
      target.removeEventListener('click', onClick, true);
      window.removeEventListener('blur', onBlur);
      listeners.clear();
    },
  };
}
