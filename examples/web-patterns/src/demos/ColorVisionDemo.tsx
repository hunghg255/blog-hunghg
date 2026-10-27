import { useEffect, useMemo, useRef, useState } from 'react';
import {
  applyColorVision,
  dataUriFilter,
  findCollisions,
  hexToRgb,
  simulate,
  VISION_LABELS,
  type VisionMode,
} from '../lib/colorVision';
import './ColorVisionDemo.css';

// Bảng màu nhãn kiểu Trello cổ điển
const LABELS: Record<string, string> = {
  'Xanh lá': '#61bd4f',
  Vàng: '#f2d600',
  Cam: '#ff9f1a',
  Đỏ: '#eb5a46',
  Tím: '#c377e0',
  'Xanh dương': '#0079bf',
};

const LISTS = [
  { title: 'Cần làm', cards: [['Sửa lỗi thanh toán', ['Đỏ']], ['Thiết kế onboarding', ['Tím', 'Vàng']]] },
  { title: 'Đang làm', cards: [['API giỏ hàng', ['Cam']], ['Trang hồ sơ', ['Xanh dương', 'Xanh lá']]] },
  { title: 'Xong', cards: [['Đăng nhập Google', ['Xanh lá']], ['Hotfix 2.3.1', ['Đỏ', 'Xanh lá']]] },
] as const;

type Method = 'inline' | 'datauri';

export default function ColorVisionDemo() {
  const boardRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<VisionMode | ''>('deuteranopia');
  const [method, setMethod] = useState<Method>('inline');
  const [toast, setToast] = useState(false);

  useEffect(() => {
    const board = boardRef.current!;
    if (method === 'inline') applyColorVision(board, mode || null);
    else if (mode) board.style.filter = dataUriFilter(mode);
    else board.style.removeProperty('filter');
  }, [mode, method]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(false), 2500);
    return () => clearTimeout(timer);
  }, [toast]);

  const matrixMode = mode && mode !== 'blurred' ? mode : null;
  const collisions = useMemo(() => (matrixMode ? findCollisions(LABELS, matrixMode, 0.1) : []), [matrixMode]);

  return (
    <div className='page color-vision-demo'>
      <h1>Giả lập khiếm thị màu</h1>
      <p className='hint'>
        Chọn một chế độ để xem bảng (board) dưới mắt người khiếm thị màu. Filter chỉ áp lên khung bảng, phần điều khiển giữ màu thật.
      </p>
      <div className='toolbar'>
        <select value={mode} onChange={(e) => setMode(e.target.value as VisionMode | '')} aria-label='Chế độ giả lập'>
          <option value=''>Không giả lập</option>
          {(Object.keys(VISION_LABELS) as VisionMode[]).map((m) => (
            <option key={m} value={m}>
              {VISION_LABELS[m]}
            </option>
          ))}
        </select>
        <label className='switch'>
          <input type='radio' name='cv-method' checked={method === 'inline'} onChange={() => setMethod('inline')} /> SVG nhúng trong
          trang
        </label>
        <label className='switch'>
          <input type='radio' name='cv-method' checked={method === 'datauri'} onChange={() => setMethod('datauri')} /> Data URI (kiểu
          Trello)
        </label>
      </div>

      <div ref={boardRef} className='cv-board'>
        {LISTS.map((list) => (
          <div key={list.title} className='cv-list'>
            <h3>{list.title}</h3>
            {list.cards.map(([title, labels]) => (
              <div key={title} className='cv-card'>
                <div className='cv-labels'>
                  {labels.map((label) => (
                    <span key={label} className='cv-label' style={{ background: LABELS[label] }} title={label} />
                  ))}
                </div>
                {title}
              </div>
            ))}
          </div>
        ))}
        <div className='cv-list cv-chart'>
          <h3>Build 7 ngày</h3>
          <div className='cv-bars'>
            {[1, 1, 0, 1, 0, 1, 1].map((ok, i) => (
              <span key={i} className={ok ? 'cv-pass' : 'cv-fail'} style={{ height: `${40 + ((i * 37) % 50)}%` }} />
            ))}
          </div>
          <small>xanh = pass, đỏ = fail</small>
          <button onClick={() => setToast(true)}>Hiện toast (position: fixed)</button>
        </div>
        {toast && <div className='cv-toast'>Toast cố định ở góc dưới màn hình… hay không?</div>}
      </div>

      <h2 className='cv-h2'>Kiểm tra palette bằng JS</h2>
      <p className='hint'>
        Cùng ma trận, tính trong JS: màu nhãn trước (trên) và sau (dưới) khi giả lập. Cặp nào khoảng cách OKLab dưới 0,10 bị liệt kê.
      </p>
      <div className='cv-swatches'>
        {Object.entries(LABELS).map(([name, hex]) => {
          const after = matrixMode ? simulate(hexToRgb(hex), matrixMode) : hexToRgb(hex);
          return (
            <div key={name} className='cv-swatch'>
              <span style={{ background: hex }} />
              <span style={{ background: `rgb(${after.join(' ')})` }} />
              <small>{name}</small>
            </div>
          );
        })}
      </div>
      {matrixMode ? (
        collisions.length ? (
          <ul className='cv-collisions'>
            {collisions.map((c) => (
              <li key={c.a + c.b} className='warn'>
                {c.a} ↔ {c.b}: {c.before.toFixed(2)} → <b>{c.after.toFixed(2)}</b>
              </li>
            ))}
          </ul>
        ) : (
          <p className='ok'>Không có cặp nào dưới ngưỡng.</p>
        )
      ) : (
        <p className='muted'>Chọn một chế độ màu (không phải "nhìn mờ") để kiểm tra.</p>
      )}
    </div>
  );
}
