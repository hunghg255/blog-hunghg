import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

/**
 * Menu aim: rê chuột chéo từ một mục menu sang submenu của nó mà không làm các mục
 * nằm trên đường đi "giành" hover (ý tưởng từ menu-aim.tsx của Udemy).
 *
 * Cách làm: phủ khoảng trống giữa mục đang mở (trigger) và submenu bằng 2 tam giác SVG
 * trong suốt. Tam giác nằm TRÊN các mục bên cạnh nên chúng không nhận được hover. Chuột
 * còn đang di chuyển đúng hướng thì giữ tam giác; đi sai hướng hoặc dừng lại thì gỡ.
 */

export interface AimArea {
  /** vị trí tuyệt đối của SVG, tính theo submenu (submenu phải có position khác static) */
  pos: { top?: string; bottom?: string; left?: string; right?: string };
  w: number;
  h: number;
  /** thuộc tính d của <path> */
  d: string;
  /** hướng chuột được kỳ vọng: x=1 sang phải, y=-1 đi lên… */
  dir: { x: 1 | -1; y: 1 | -1 };
  /** submenu nằm trên/dưới trigger (true) hay trái/phải (false) */
  vertical: boolean;
}

// +2: bịt khe hở 1-2px giữa trigger và tam giác do làm tròn pixel hoặc border
const GAP = 2;

/** Tính 2 tam giác từ hình chữ nhật của trigger và submenu (4 trường hợp vị trí). */
export function computeAimAreas(t: DOMRect, m: DOMRect): [AimArea, AimArea] {
  const r = Math.round;
  if (t.top >= m.bottom) {
    // submenu ở TRÊN trigger: 2 tam giác ở hai bên trigger
    const h = r(t.bottom - m.bottom);
    const w1 = r(t.left - m.left) + GAP;
    const w2 = r(m.right - t.right) + GAP;
    return [
      { pos: { top: '100%', left: '0' }, w: w1, h, d: `M${w1} ${h}V0H0Z`, dir: { x: -1, y: -1 }, vertical: true },
      { pos: { top: '100%', right: '0' }, w: w2, h, d: `M0 ${h}V0H${w2}Z`, dir: { x: 1, y: -1 }, vertical: true },
    ];
  }
  if (t.bottom <= m.top) {
    // submenu ở DƯỚI trigger
    const h = r(m.top - t.top);
    const w1 = r(t.left - m.left) + GAP;
    const w2 = r(m.right - t.right) + GAP;
    return [
      { pos: { bottom: '100%', left: '0' }, w: w1, h, d: `M${w1} 0V${h}H0Z`, dir: { x: -1, y: 1 }, vertical: true },
      { pos: { bottom: '100%', right: '0' }, w: w2, h, d: `M0 0V${h}H${w2}Z`, dir: { x: 1, y: 1 }, vertical: true },
    ];
  }
  if (t.right <= m.left) {
    // submenu bên PHẢI trigger: 2 tam giác ở trên và dưới trigger
    const w = r(m.left - t.left);
    const h1 = r(t.top - m.top) + GAP;
    const h2 = r(m.bottom - t.bottom) + GAP;
    return [
      { pos: { top: '0', right: '100%' }, w, h: h1, d: `M0 ${h1}H${w}V0Z`, dir: { x: 1, y: -1 }, vertical: false },
      { pos: { bottom: '0', right: '100%' }, w, h: h2, d: `M0 0H${w}V${h2}Z`, dir: { x: 1, y: 1 }, vertical: false },
    ];
  }
  // submenu bên TRÁI trigger
  const w = r(t.right - m.right);
  const h1 = r(t.top - m.top) + GAP;
  const h2 = r(m.bottom - t.bottom) + GAP;
  return [
    { pos: { top: '0', left: '100%' }, w, h: h1, d: `M${w} ${h1}H0V0Z`, dir: { x: -1, y: -1 }, vertical: false },
    { pos: { bottom: '0', left: '100%' }, w, h: h2, d: `M${w} 0H0V${h2}Z`, dir: { x: -1, y: 1 }, vertical: false },
  ];
}

/**
 * Chuột (tính từ lúc vào tam giác) có đang đi sai hướng không.
 * Sai nếu: đi theo đường chéo ngược lại, hoặc góc lệch quá xa so với cạnh huyền
 * (Udemy: độ dốc thực tế lệch quá 2 lần độ dốc kỳ vọng).
 */
export function isAimWrong(area: AimArea, dx: number, dy: number): boolean {
  const xOk = dx === 0 || dx > 0 === area.dir.x > 0;
  const yOk = dy === 0 || dy > 0 === area.dir.y > 0;
  if (xOk !== yOk) return true; // sai đường chéo
  const expected = Math.abs(area.h / area.w);
  const actual = Math.abs(dy / dx); // dx = 0 cho ra Infinity, vẫn so sánh được
  // submenu trên/dưới: đi quá ngang là sai; submenu trái/phải: đi quá dọc là sai
  return area.vertical ? 2 * actual < expected : 2 * expected < actual;
}

export interface UseMenuAimOptions {
  triggerRef: RefObject<HTMLElement | null>;
  menuRef: RefObject<HTMLElement | null>;
  /**
   * Gọi khi tam giác bị gỡ (chuột dừng hoặc đi sai hướng), kèm vị trí chuột.
   * Phần tử nằm dưới chuột lúc này không tự nhận mouseover (chuột không hề di chuyển),
   * nên thường cần tự kích hoạt mục dưới con trỏ (Udemy: `forceHover`).
   */
  onAimEnd?: (point: { x: number; y: number }) => void;
  /** chuột dừng quá chừng này ms thì gỡ tam giác (Udemy: 25) */
  stopDelay?: number;
  /** bỏ qua mousemove trong bán kính này quanh điểm vào, tránh gỡ ngay khi tam giác vừa hiện (Udemy: 4px) */
  moveThreshold?: number;
  /** tô màu tam giác để nhìn thấy (debug/demo) */
  debug?: boolean;
}

export function useMenuAim({ triggerRef, menuRef, onAimEnd, stopDelay = 25, moveThreshold = 4, debug = false }: UseMenuAimOptions) {
  const [areas, setAreas] = useState<AimArea[] | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const onAimEndRef = useRef(onAimEnd);
  useEffect(() => {
    onAimEndRef.current = onAimEnd;
  });
  useEffect(() => () => clearTimeout(timer.current), []);

  /** Gọi sau khi submenu của trigger mới đã render (vd trong useLayoutEffect). */
  const update = useCallback(() => {
    const trigger = triggerRef.current;
    const menu = menuRef.current;
    clearTimeout(timer.current);
    setAreas(trigger && menu ? computeAimAreas(trigger.getBoundingClientRect(), menu.getBoundingClientRect()) : null);
  }, [triggerRef, menuRef]);

  // điểm chuột lúc gỡ tam giác; báo cho người dùng SAU khi React đã gỡ SVG khỏi DOM,
  // nếu không elementFromPoint ở phía người dùng vẫn trả về chính tam giác
  // (Udemy làm tương tự bằng cách bọc forceHover trong setTimeout 0)
  const endedAt = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    if (areas === null && endedAt.current) {
      const point = endedAt.current;
      endedAt.current = null;
      onAimEndRef.current?.(point);
    }
  }, [areas]);

  const hide = useCallback((point: { x: number; y: number }, delay: number) => {
    clearTimeout(timer.current);
    const run = () => {
      endedAt.current = point;
      setAreas(null);
    };
    if (delay) timer.current = setTimeout(run, delay);
    else run();
  }, []);

  const cancelHide = useCallback(() => clearTimeout(timer.current), []);

  const aimArea = areas
    ? areas.map((area, i) => (
        <AimTriangle
          key={i}
          area={area}
          debug={debug}
          stopDelay={stopDelay}
          moveThreshold={moveThreshold}
          onHide={hide}
          onLeave={cancelHide}
        />
      ))
    : null;

  return { update, aimArea, active: areas !== null };
}

interface AimTriangleProps {
  area: AimArea;
  debug: boolean;
  stopDelay: number;
  moveThreshold: number;
  onHide: (point: { x: number; y: number }, delay: number) => void;
  onLeave: () => void;
}

function AimTriangle({ area, debug, stopDelay, moveThreshold, onHide, onLeave }: AimTriangleProps) {
  // điểm chuột đi vào tam giác; dùng ref (Udemy dùng state -> re-render mỗi lần mousemove)
  const start = useRef<{ x: number; y: number } | null>(null);
  // tam giác quá nhỏ thì không cần (Udemy: <= 4px)
  if (area.w <= 4 || area.h <= 4) return null;

  return (
    <svg
      aria-hidden='true'
      focusable='false'
      width={area.w}
      height={area.h}
      style={{ position: 'absolute', pointerEvents: 'none', overflow: 'visible', ...area.pos }}
    >
      <path
        d={area.d}
        style={{
          pointerEvents: 'auto',
          fill: debug ? 'color-mix(in oklab, var(--accent, #f80) 28%, transparent)' : 'transparent',
          stroke: debug ? 'var(--accent, #f80)' : 'none',
          strokeDasharray: '4 3',
        }}
        onMouseEnter={(e) => {
          start.current = { x: e.clientX, y: e.clientY };
          // khác bản gốc: chuột vào rồi đứng yên (chưa đi quá moveThreshold) thì cũng gỡ sau
          // một lúc, không để tam giác che mục bên dưới mãi
          onHide({ x: e.clientX, y: e.clientY }, stopDelay * 4);
        }}
        onMouseMove={(e) => {
          const origin = (start.current ??= { x: e.clientX, y: e.clientY });
          const dx = e.clientX - origin.x;
          const dy = e.clientY - origin.y;
          if (Math.abs(dx) <= moveThreshold && Math.abs(dy) <= moveThreshold) return;
          // đúng hướng: gia hạn thêm stopDelay mỗi lần chuột nhúc nhích; sai hướng: gỡ ngay
          onHide({ x: e.clientX, y: e.clientY }, isAimWrong(area, dx, dy) ? 0 : stopDelay);
        }}
        onMouseLeave={onLeave}
      />
    </svg>
  );
}
