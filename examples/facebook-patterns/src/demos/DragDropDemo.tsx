import { useCallback, useRef, useState } from 'react';
import { useDragReorder, useFileDropZone } from '../lib/dragReorder';
import { Log, Stat, useLog } from './shared';
import './DragDropDemo.css';

interface Card {
  id: string;
  title: string;
  height: number;
}

const INITIAL: Card[] = [
  { id: 'a', title: 'Ảnh bìa', height: 120 },
  { id: 'b', title: 'Video ngắn', height: 44 },
  { id: 'c', title: 'Album 12 ảnh', height: 96 },
  { id: 'd', title: 'Ghi chú', height: 44 },
  { id: 'e', title: 'Ảnh dọc', height: 150 },
  { id: 'f', title: 'GIF', height: 56 },
];

function ReorderList() {
  const [cards, setCards] = useState(INITIAL);
  const [swapRule, setSwapRule] = useState<'edge' | 'enter'>('edge');
  const [commitOnCancel, setCommitOnCancel] = useState(false);
  const [swaps, setSwaps] = useState(0);
  const { lines, add } = useLog(20);
  const onReorder = useCallback(
    (next: Card[], from: number, to: number) => {
      setCards(next);
      add(`commit: #${from + 1} → #${to + 1}`, 'ok');
    },
    [add],
  );
  const { preview, draggingIndex, isDragging, getItemProps } = useDragReorder({
    items: cards,
    getKey: (card) => card.id,
    onReorder,
    swapRule,
    commitOnCancel,
    onPreviewChange: () => setSwaps((n) => n + 1),
  });

  return (
    <section className='dd-panel'>
      <h2>Sắp xếp bằng kéo-thả</h2>
      <div className='toolbar'>
        <label className='switch'>
          <input type='radio' checked={swapRule === 'edge'} onChange={() => setSwapRule('edge')} /> Mép phải vượt mép (Facebook)
        </label>
        <label className='switch'>
          <input type='radio' checked={swapRule === 'enter'} onChange={() => setSwapRule('enter')} /> Đổi ngay khi chạm
        </label>
        <label className='switch'>
          <input type='checkbox' checked={commitOnCancel} onChange={(e) => setCommitOnCancel(e.target.checked)} /> Commit cả khi huỷ (bản gốc)
        </label>
        <button onClick={() => (setCards(INITIAL), setSwaps(0))}>Đặt lại</button>
      </div>
      <div className='stats'>
        <Stat label='lần đổi chỗ khi đang kéo' value={swaps} />
        <Stat label='thứ tự' value={<bdi data-testid='order'>{cards.map((c) => c.id).join('')}</bdi>} />
      </div>
      <ol className='dd-list'>
        {preview.map((card, index) => (
          <li
            key={card.id}
            {...getItemProps(index)}
            data-id={card.id}
            className={`dd-card${isDragging && index === draggingIndex ? ' dragging' : ''}`}
            style={{ height: card.height }}
          >
            <span className='dd-grip' aria-hidden>
              ⋮⋮
            </span>
            {card.title}
          </li>
        ))}
      </ol>
      <Log lines={lines} />
    </section>
  );
}

function FileDrop() {
  const [mode, setMode] = useState<'counter' | 'boolean'>('counter');
  const [detect, setDetect] = useState<'types' | 'files-not-null'>('types');
  const [toggles, setToggles] = useState(0);
  const { lines, add } = useLog(20);
  const toggleCount = useRef(0);
  const { ref, active } = useFileDropZone<HTMLDivElement>({
    mode,
    detect,
    onFiles: (files) => add(`thả ${files.length} file: ${files.map((f) => f.name).join(', ')}`, 'ok'),
    onToggle: () => {
      toggleCount.current++;
      setToggles(toggleCount.current);
    },
  });

  return (
    <section className='dd-panel'>
      <h2>Overlay thả file</h2>
      <div className='toolbar'>
        <label className='switch'>
          <input type='radio' checked={mode === 'counter'} onChange={() => setMode('counter')} /> Bộ đếm enter/leave
        </label>
        <label className='switch'>
          <input type='radio' checked={mode === 'boolean'} onChange={() => setMode('boolean')} /> Cờ boolean
        </label>
        <label className='switch'>
          <input type='checkbox' checked={detect === 'files-not-null'} onChange={(e) => setDetect(e.target.checked ? 'files-not-null' : 'types')} /> Nhận
          diện kéo file như bản gốc (<code>files != null</code>)
        </label>
        <button onClick={() => ((toggleCount.current = 0), setToggles(0))}>Đếm lại</button>
      </div>
      <div className='stats'>
        <Stat label='lần overlay bật/tắt' value={<bdi data-testid='toggles'>{toggles}</bdi>} />
      </div>
      <p className='hint'>
        Kéo một file từ máy vào khung, rê qua các ô con. Hoặc kéo{' '}
        <span className='dd-text' draggable onDragStart={(e) => e.dataTransfer.setData('text/plain', 'chỉ là chữ')}>
          dòng chữ này
        </span>{' '}
        vào khung: nó không phải file, overlay không nên hiện.
      </p>
      <div ref={ref} className={`dd-zone${active ? ' active' : ''}`} data-testid='zone'>
        <div className='dd-zone-head'>Bài viết mới</div>
        <div className='dd-zone-body'>
          <div className='dd-chip'>Ảnh</div>
          <div className='dd-chip'>Video</div>
          <div className='dd-chip'>
            <span>Cảm xúc</span>
          </div>
        </div>
        {active && <div className='dd-overlay'>Thả file vào đây</div>}
      </div>
      <Log lines={lines} />
    </section>
  );
}

export default function DragDropDemo() {
  return (
    <div className='page'>
      <h1>Kéo-thả không nhấp nháy</h1>
      <p className='hint'>
        Hai mẹo từ code Facebook: đổi chỗ chỉ khi mép phần tử đang kéo vượt mép phần tử đích (useCometDraggableItems), và đếm dragenter/dragleave để
        overlay thả file không chớp khi rê qua phần tử con (useFileDragEvents).
      </p>
      <div className='dd-grid'>
        <ReorderList />
        <FileDrop />
      </div>
    </div>
  );
}
