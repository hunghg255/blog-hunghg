import { useMemo, useState } from 'react';
import { calculateAlbumLayout, Side, type Box } from '../lib/tgAlbumLayout';
import { Stat } from './shared';
import './TgAlbumDemo.css';

const PRESETS: { label: string; ratios: number[] }[] = [
  { label: '2 ảnh ngang giống nhau', ratios: [1.78, 1.6] },
  { label: '1 ngang + 1 dọc', ratios: [1.5, 0.66] },
  { label: '3 ảnh, ảnh đầu dọc', ratios: [0.6, 1.33, 1.5] },
  { label: '4 ảnh, ảnh đầu ngang', ratios: [1.78, 1, 0.75, 1.33] },
  { label: '5 ảnh trộn', ratios: [1.5, 0.75, 1, 1.33, 0.8] },
  { label: '7 ảnh dọc', ratios: [0.66, 0.75, 0.56, 0.7, 0.75, 0.66, 0.6] },
  { label: '10 ảnh', ratios: [1.33, 1, 0.75, 1.78, 1.5, 0.66, 1, 1.33, 0.8, 1.6] },
  { label: '3 ảnh có panorama 3:1', ratios: [3, 1, 0.75] },
];

const COLORS = [
  '#2aabee',
  '#7bc862',
  '#e17076',
  '#a695e7',
  '#faa774',
  '#6ec9cb',
  '#ee7aae',
  '#65aadd',
  '#d4a017',
  '#8e9eab',
];

function radius(sides: number, r = 12) {
  const has = (s: number) => (sides & s) === s;
  const tl = has(Side.Top | Side.Left) ? r : 0;
  const tr = has(Side.Top | Side.Right) ? r : 0;
  const br = has(Side.Bottom | Side.Right) ? r : 0;
  const bl = has(Side.Bottom | Side.Left) ? r : 0;
  return `${tl}px ${tr}px ${br}px ${bl}px`;
}

const randomRatios = () => {
  const n = 2 + Math.floor(Math.random() * 9);
  const pool = [0.56, 0.66, 0.75, 0.8, 1, 1, 1.33, 1.5, 1.78, 2.2];
  return Array.from({ length: n }, () => pool[Math.floor(Math.random() * pool.length)]);
};

export default function TgAlbumDemo() {
  const [ratios, setRatios] = useState(PRESETS[4].ratios);
  // màn hẹp (iframe trên điện thoại): bắt đầu với bề ngang vừa khung
  const [maxWidth, setMaxWidth] = useState(() =>
    Math.max(240, Math.min(360, Math.floor((window.innerWidth - 40) / 20) * 20)),
  );
  const [legacy, setLegacy] = useState(true);

  const layout = useMemo(
    () => calculateAlbumLayout(ratios, { maxWidth, legacyAverage: legacy }),
    [ratios, maxWidth, legacy],
  );
  const other = useMemo(
    () => calculateAlbumLayout(ratios, { maxWidth, legacyAverage: !legacy }),
    [ratios, maxWidth, legacy],
  );
  const differs =
    layout.strategy !== other.strategy ||
    JSON.stringify(layout.boxes) !== JSON.stringify(other.boxes);

  const attempts = layout.attempts ? [...layout.attempts].sort((a, b) => a.cost - b.cost) : [];

  return (
    <div className='page tga'>
      <h1>Bố cục album chọn theo hàm chi phí</h1>
      <p className='hint'>
        Chọn một bộ ảnh (mỗi ô ghi tỉ lệ rộng/cao). Từ 5 ảnh, thuật toán thử mọi cách chia 2–4 hàng
        và chọn cách có tổng chiều cao gần {maxWidth}px nhất.
      </p>
      <div className='toolbar'>
        {PRESETS.map((preset) => (
          <button
            key={preset.label}
            className={preset.ratios === ratios ? 'primary' : ''}
            onClick={() => setRatios(preset.ratios)}
          >
            {preset.label}
          </button>
        ))}
        <button onClick={() => setRatios(randomRatios())}>Ngẫu nhiên</button>
      </div>
      <div className='toolbar'>
        <label>
          Bề ngang tối đa {maxWidth}px
          <input
            type='range'
            min={240}
            max={480}
            step={20}
            value={maxWidth}
            onChange={(e) => setMaxWidth(+e.target.value)}
          />
        </label>
        <label>
          <input type='checkbox' checked={legacy} onChange={(e) => setLegacy(e.target.checked)} />{' '}
          Trung bình kiểu bản gốc (lệch +1/n)
        </label>
      </div>
      <div className='stats'>
        <Stat label='số ảnh' value={ratios.length} />
        <Stat label='dáng (w/n/q)' value={layout.proportions} />
        <Stat label='tỉ lệ trung bình' value={layout.averageRatio.toFixed(2)} />
        <Stat label='phương án' value={layout.strategy} />
        <Stat label='khung album' value={`${layout.width}×${layout.height}`} />
      </div>
      {differs && (
        <p className='warn' data-testid='legacy-diff'>
          Với bộ ảnh này, cách tính trung bình đổi kết quả: {legacy ? 'bản sửa' : 'bản gốc'} cho ra
          "{other.strategy}" khung {other.width}×{other.height}.
        </p>
      )}
      <div className='tga-scroll'>
        <div
          className='tga-album'
          style={{ width: layout.width, height: layout.height }}
          data-testid='album'
        >
          {layout.boxes.map((box: Box, i) => (
            <div
              key={i}
              className='tga-box'
              style={{
                left: box.x,
                top: box.y,
                width: box.width,
                height: box.height,
                background: COLORS[i % COLORS.length],
                borderRadius: radius(box.sides),
              }}
            >
              <b>{i + 1}</b>
              <small>{ratios[i].toFixed(2)}</small>
            </div>
          ))}
        </div>
      </div>
      {attempts.length > 0 && (
        <>
          <h2 className='tga-h2'>
            Các phương án đã thử ({attempts.length}), chi phí thấp nhất ở trên
          </h2>
          <div className='tga-scroll'>
            <table className='tga-table'>
              <thead>
                <tr>
                  <th>Số ảnh mỗi hàng</th>
                  <th>Chiều cao các hàng</th>
                  <th>Tổng</th>
                  <th>Chi phí</th>
                  <th>Phạt</th>
                </tr>
              </thead>
              <tbody>
                {attempts.slice(0, 8).map((attempt, i) => (
                  <tr key={attempt.lineCounts.join()} className={i === 0 ? 'tga-best' : ''}>
                    <td>{attempt.lineCounts.join(' + ')}</td>
                    <td>{attempt.heights.map((h) => Math.round(h)).join(', ')}</td>
                    <td>{Math.round(attempt.totalHeight)}</td>
                    <td>{attempt.cost.toFixed(1)}</td>
                    <td>{attempt.penalties.join('; ') || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
