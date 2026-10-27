import type { CSSProperties } from 'react';

/**
 * Cắt ảnh vừa khung theo "điểm quan trọng" (focal point), không bao giờ để hở mép
 * (ý tưởng từ CometFeedFocusMedia / CometFeedFocusImage của Facebook).
 *
 * Giống object-fit: cover, nhưng thay vì luôn căn giữa, ta dịch ảnh sao cho điểm focus nằm
 * càng gần tâm khung càng tốt, rồi kẹp lại để mép ảnh không lọt vào trong khung.
 */

export interface FocalCrop {
  /** kích thước lớp bọc ảnh, tính theo % khung */
  width: string;
  height: string;
  /** dịch theo trục nào và bao nhiêu % */
  axis: 'top' | 'left';
  offsetPercent: number;
}

/**
 * @param mediaAspect  tỉ lệ rộng/cao của ảnh
 * @param frameAspect  tỉ lệ rộng/cao của khung
 * @param focusX, focusY  điểm focus trong ảnh, 0..1 (0.5 = giữa)
 */
export function computeFocalCrop(
  mediaAspect: number,
  frameAspect: number,
  focusX = 0.5,
  focusY = 0.5,
): FocalCrop {
  if (mediaAspect < frameAspect) {
    // Ảnh "cao" hơn khung: rộng = 100% khung, cao = m lần khung (m > 1) -> trượt theo trục dọc.
    const m = frameAspect / mediaAspect;
    return { width: '100%', height: `${m * 100}%`, axis: 'top', offsetPercent: clampOffset(m, focusY) };
  }
  // Ảnh "rộng" hơn (hoặc bằng) khung: cao = 100%, rộng = m lần -> trượt theo trục ngang.
  const m = mediaAspect / frameAspect;
  return { width: `${m * 100}%`, height: '100%', axis: 'left', offsetPercent: clampOffset(m, focusX) };
}

/**
 * Ảnh dài gấp m lần khung theo trục đang xét. Muốn điểm focus f (0..1 theo chiều dài ảnh) nằm
 * giữa khung: vị trí focus = offset + m·f = 0.5  =>  offset = 0.5 − m·f.
 * Kẹp vào [1 − m, 0]: offset > 0 thì hở mép đầu, offset < 1 − m thì hở mép cuối.
 */
function clampOffset(m: number, focus: number) {
  return Math.max(Math.min(0.5 - m * focus, 0), 1 - m) * 100;
}

export interface FocalPointImageProps {
  src: string;
  alt?: string;
  mediaWidth: number;
  mediaHeight: number;
  focusX?: number;
  focusY?: number;
  /** tỉ lệ rộng/cao của khung */
  frameAspect: number;
  /** true = lấp đầy phần tử cha (cha phải có kích thước), false = tự tạo khung theo frameAspect */
  fill?: boolean;
  style?: CSSProperties;
}

export function FocalPointImage({
  src,
  alt = '',
  mediaWidth,
  mediaHeight,
  focusX = 0.5,
  focusY = 0.5,
  frameAspect,
  fill = false,
  style,
}: FocalPointImageProps) {
  const crop = computeFocalCrop(mediaWidth / mediaHeight, frameAspect, focusX, focusY);
  const frame: CSSProperties = fill
    ? { position: 'absolute', inset: 0, overflow: 'hidden' }
    : // padding-top theo % tính trên CHIỀU RỘNG của cha -> khung giữ đúng tỉ lệ (trước khi có aspect-ratio)
      { position: 'relative', overflow: 'hidden', paddingTop: `${100 / frameAspect}%` };
  return (
    <div style={{ ...frame, ...style }}>
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: crop.width,
          height: crop.height,
          [crop.axis]: `${crop.offsetPercent}%`,
        }}
      >
        <img
          src={src}
          alt={alt}
          draggable={false}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }}
        />
      </div>
    </div>
  );
}
