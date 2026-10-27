import { createContext, useContext, useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { observeIntersection } from './observeIntersection';
import './glimmer.css';

/**
 * Skeleton loading tiết kiệm CPU (ý tưởng từ BaseGlimmer + BaseLoadingStateElement của Facebook):
 * - animation dùng `steps(10, end)`: mỗi giây chỉ đổi ~10 lần thay vì 60
 * - `animation-delay = 1000 + 100 * index` ms: tải nhanh dưới 1 giây thì không thấy nháy,
 *   và các khối sáng lên lần lượt như một làn sóng
 * - tạm dừng (animation-play-state: paused) khi nằm ngoài viewport
 * - chỉ glimmer ngoài cùng mang thuộc tính ARIA "đang tải", các glimmer lồng bên trong thì không
 */

const BASE_DELAY_MS = 1000;
const STEP_DELAY_MS = 100;

// true khi đang nằm bên trong một Glimmer khác
const InsideGlimmerContext = createContext(false);

export interface GlimmerProps {
  /** thứ tự trong danh sách, quyết định độ trễ so le */
  index?: number;
  /** demo: chuyển sang nội suy mượt để so sánh */
  smooth?: boolean;
  style?: CSSProperties;
  className?: string;
  children?: ReactNode;
}

export function Glimmer({ index = 0, smooth = false, style, className, children }: GlimmerProps) {
  const nested = useContext(InsideGlimmerContext);
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  // Mặc định paused: chưa biết có nằm trong viewport không thì đừng tốn CPU.
  const [paused, setPaused] = useState(true);

  useEffect(() => {
    if (!node) return;
    // Dùng chung IntersectionObserver với cả trang (bài #1): bao nhiêu skeleton cũng chỉ 1 observer.
    return observeIntersection(node, (entry) => setPaused(!entry.isIntersecting));
  }, [node]);

  const ariaProps = nested
    ? {}
    : {
        role: 'progressbar',
        'aria-busy': true,
        'aria-valuemin': 0,
        'aria-valuemax': 100,
        'aria-valuetext': 'Đang tải...',
      };

  return (
    <InsideGlimmerContext.Provider value={true}>
      <div
        ref={setNode}
        className={`glimmer${className ? ` ${className}` : ''}`}
        data-paused={paused}
        data-smooth={smooth}
        style={{ animationDelay: `${BASE_DELAY_MS + STEP_DELAY_MS * index}ms`, ...style }}
        {...ariaProps}
      >
        {children}
      </div>
    </InsideGlimmerContext.Provider>
  );
}
