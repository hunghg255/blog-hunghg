import { useId } from 'react';

/**
 * Avatar "khoét rãnh" bằng SVG mask (ý tưởng từ TetraProfilePhoto + profilePhotoUtils của Facebook).
 *
 * Thay vì vẽ viền trắng quanh chấm online (hỏng khi nền tối hoặc nền là ảnh), ta khoét một lỗ
 * trong suốt ngay trên avatar: mask = hình tròn trắng (giữ lại) + hình tròn đen ở chỗ badge
 * (cắt bỏ). Nền phía sau lộ ra qua khe hở, nên trên nền nào trông cũng đúng.
 */

export type AvatarShape = 'circle' | 'roundedRect';

/**
 * Khoảng cách (px) từ cạnh phải/dưới tới tâm badge sao cho tâm badge nằm đúng trên đường tròn
 * avatar, ở góc 45°.
 *
 * Từ góc hình vuông bao tới tâm, theo đường chéo là r·√2. Đường tròn cách tâm r, nên đoạn từ
 * góc tới đường tròn là d = r·√2 − r. Chiếu đoạn chéo d xuống trục x/y: d/√2.
 */
export function getBadgeOffset(radius: number): number {
  const diagonal = Math.sqrt(2 * radius * radius) - radius;
  return Math.round(Math.sqrt((diagonal * diagonal) / 2));
}

/**
 * Kích thước chấm online và độ dày "khe hở" theo cỡ avatar: bảng tra giống hệt Facebook
 * (getBadgeSizeAndStrokeWidth với type "availabilityBadge"). Cỡ không có trong bảng -> [8, 2].
 */
const AVAILABILITY_BADGE: Record<number, [size: number, gap: number]> = {
  16: [6, 1.5],
  20: [6, 1.5],
  24: [6, 1.5],
  28: [7, 2],
  32: [8, 2],
  36: [8, 2],
  40: [9, 2],
  48: [9, 2],
  56: [10, 2],
  60: [10, 2],
  72: [12, 2],
  80: [14, 2],
  88: [14, 2],
  96: [15, 2],
  100: [15, 2],
  132: [20, 4],
  168: [20, 4],
};

export function getBadgeSizeAndGap(avatarSize: number): [number, number] {
  return AVAILABILITY_BADGE[avatarSize] ?? [8, 2];
}

/** Badge số thông báo: viên thuốc cao 22px, rộng 22/33/44 cho 1/2/3 chữ số (như Facebook). */
export function getCountPillWidth(count: number): number {
  return count <= 9 ? 22 : count <= 99 ? 33 : 44;
}

export interface MaskedAvatarProps {
  src: string;
  size: number;
  alt?: string;
  shape?: AvatarShape;
  /** hiện chấm xanh online ở góc dưới phải */
  online?: boolean;
  /** hiện badge số thông báo ở góc trên phải */
  count?: number;
  /**
   * Avatar này nằm đè lên avatar phía trước trong facepile (marginLeft âm 4px):
   * khoét thêm một vòng cung để tách khỏi avatar trước.
   */
  overlapped?: boolean;
}

export function MaskedAvatar({
  src,
  size,
  alt,
  shape = 'circle',
  online = false,
  count,
  overlapped = false,
}: MaskedAvatarProps) {
  // useId trả về chuỗi có thể chứa ký tự như ":" hoặc "«»". Trong `url(#…)` mấy ký tự đó dễ
  // gây lỗi, nên lọc lại chỉ giữ chữ, số, gạch.
  const maskId = `avatar-mask-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const radius = size / 2;
  const offset = getBadgeOffset(radius);
  const [badgeSize, gap] = getBadgeSizeAndGap(size);
  const showCount = count != null && count > 0;
  const pillWidth = showCount ? getCountPillWidth(count) : 0;
  const PILL_HEIGHT = 22;

  return (
    <span
      style={{ position: 'relative', display: 'inline-block', width: size, height: size, verticalAlign: 'middle' }}
    >
      <svg width={size} height={size} role={alt ? 'img' : 'none'} aria-label={alt} style={{ display: 'block' }}>
        <mask id={maskId}>
          {/* trắng = giữ lại, đen = cắt bỏ */}
          {shape === 'circle' ? (
            <circle cx={radius} cy={radius} r={radius} fill='white' />
          ) : (
            <rect width={size} height={size} rx={8} ry={8} fill='white' />
          )}
          {online && (
            // tâm badge = góc dưới phải lùi vào `offset`; bán kính lỗ = bán kính badge + khe hở
            <circle cx={size - offset} cy={size - offset} r={badgeSize / 2 + gap} fill='black' />
          )}
          {showCount && (
            <rect
              x={size - offset - pillWidth / 2 - gap}
              y={offset - PILL_HEIGHT / 2 - gap}
              width={pillWidth + gap * 2}
              height={PILL_HEIGHT + gap * 2}
              rx={PILL_HEIGHT / 2 + gap}
              fill='black'
            />
          )}
          {overlapped && (
            // avatar phía trước có tâm ở x = −size/2 + 4 (do marginLeft −4px);
            // cắt một hình tròn lớn hơn nó 2px -> chừa khe 2px hình lưỡi liềm
            <circle cx={-radius + 4} cy={radius} r={radius + 2} fill='black' />
          )}
        </mask>
        <g mask={`url(#${maskId})`}>
          <image href={src} width={size} height={size} preserveAspectRatio='xMidYMid slice' />
          {/* viền trong rất mờ để ảnh trắng không "tan" vào nền trắng */}
          {shape === 'circle' ? (
            <circle cx={radius} cy={radius} r={radius - 0.5} fill='none' stroke='rgb(0 0 0 / 0.1)' />
          ) : (
            <rect x={0.5} y={0.5} width={size - 1} height={size - 1} rx={8} fill='none' stroke='rgb(0 0 0 / 0.1)' />
          )}
        </g>
      </svg>
      {online && (
        <span
          aria-label='Đang hoạt động'
          style={{
            position: 'absolute',
            right: offset,
            bottom: offset,
            width: badgeSize,
            height: badgeSize,
            borderRadius: '50%',
            background: '#31a24c',
            // đưa tâm badge (chứ không phải góc) về đúng điểm (right, bottom)
            transform: 'translate(50%, 50%)',
          }}
        />
      )}
      {showCount && (
        <span
          style={{
            position: 'absolute',
            right: offset,
            top: offset,
            width: pillWidth,
            height: PILL_HEIGHT,
            padding: '0 6px',
            boxSizing: 'border-box',
            borderRadius: PILL_HEIGHT / 2,
            background: '#e41e3f',
            color: 'white',
            font: '600 12px/22px system-ui, sans-serif',
            textAlign: 'center',
            transform: 'translate(50%, -50%)',
          }}
        >
          {count > 99 ? '99+' : count}
        </span>
      )}
    </span>
  );
}

export interface FacepileProps {
  sources: string[];
  size?: number;
}

/** Hàng avatar chồng lên nhau, mỗi avatar (trừ cái đầu) khoét vòng cung tách khỏi cái trước. */
export function Facepile({ sources, size = 32 }: FacepileProps) {
  return (
    <span style={{ display: 'inline-flex' }}>
      {sources.map((src, i) => (
        <span key={i} style={{ marginLeft: i === 0 ? 0 : -4 }}>
          <MaskedAvatar src={src} size={size} overlapped={i > 0} />
        </span>
      ))}
    </span>
  );
}
