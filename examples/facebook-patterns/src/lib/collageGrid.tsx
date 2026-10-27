import { cellHeight, cellWidth, gridSize, type PlacedCell } from './collageLayout';
import { FocalPointImage } from './focalPointImage';

/**
 * Vẽ collage bằng định vị tuyệt đối theo %, giống CometAlbumGridLayout của Facebook:
 * khung ngoài giữ tỉ lệ rows/cols bằng padding-top, mỗi ô đặt top/right/bottom/left bằng
 * calc(% + khe hở). Không cần CSS grid, không cần đo bằng JS.
 */

export interface CollagePhoto {
  src: string;
  width: number;
  height: number;
  focusX?: number;
  focusY?: number;
  alt?: string;
}

// Facebook: khe giữa các ô 2px, mỗi bên ô lùi 2/2 + 0.01 px (0.01 để tránh khe 0.5px bị làm tròn mất)
const GAP_PX = 2 / 2 + 0.01;

export interface CollageGridProps {
  photos: readonly CollagePhoto[];
  placed: readonly PlacedCell[];
  overflowCount: number;
  onCellClick?: (mediaIndex: number) => void;
}

export function CollageGrid({ photos, placed, overflowCount, onCellClick }: CollageGridProps) {
  const { columns, rows } = gridSize(placed);
  if (columns === 0) return null;
  return (
    <div style={{ position: 'relative', paddingTop: `calc(${rows * 100}% / ${columns})` }}>
      {placed.map(({ mediaIndex, cell }, i) => {
        const [top, right, bottom, left] = cell;
        const photo = photos[mediaIndex];
        const isLast = i === placed.length - 1;
        return (
          <div
            key={mediaIndex}
            onClick={() => onCellClick?.(mediaIndex)}
            style={{
              position: 'absolute',
              overflow: 'hidden',
              // chỉ lùi vào ở cạnh tiếp giáp ô khác, cạnh sát viền ngoài thì không
              top: `calc(${(top * 100) / rows}% + ${top > 0 ? GAP_PX : 0}px)`,
              left: `calc(${(left * 100) / columns}% + ${left > 0 ? GAP_PX : 0}px)`,
              bottom: `calc(${((rows - bottom) * 100) / rows}% + ${bottom < rows ? GAP_PX : 0}px)`,
              right: `calc(${((columns - right) * 100) / columns}% + ${right < columns ? GAP_PX : 0}px)`,
              cursor: onCellClick ? 'pointer' : undefined,
            }}
          >
            <FocalPointImage
              fill
              src={photo.src}
              alt={photo.alt}
              mediaWidth={photo.width}
              mediaHeight={photo.height}
              focusX={photo.focusX}
              focusY={photo.focusY}
              // ô trên lưới có đơn vị vuông nên tỉ lệ khung = số cột / số hàng của ô
              frameAspect={cellWidth(cell) / cellHeight(cell)}
            />
            {isLast && overflowCount > 0 && (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'grid',
                  placeItems: 'center',
                  background: 'rgb(0 0 0 / 0.45)',
                  color: '#fff',
                  font: '700 28px system-ui, sans-serif',
                  pointerEvents: 'none',
                }}
              >
                +{overflowCount}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
