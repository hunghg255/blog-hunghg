import { useEffect, useRef, useState } from 'react';
import { BufferSet } from '../lib/bufferSet';
import { Log, Stat, useLog } from './shared';
import './BufferSetDemo.css';

const ROWS = 10_000;
const ROW_H = 32;
const VIEW_H = 256;
const OVERSCAN = 2;
const MAX_NODES = Math.ceil(VIEW_H / ROW_H) + 1 + 2 * OVERSCAN;

const HUES = [12, 48, 96, 150, 190, 220, 260, 300, 330, 70, 120, 170, 240, 280];

/** Một "chỗ" DOM: key là position nên React giữ nguyên node khi dòng bên trong đổi. */
function Slot({ position, row, visible, onMount }: { position: number; row: number; visible: boolean; onMount: () => void }) {
  // chỉ đếm lần mount thật (ref callback chạy lại khi node mới được tạo)
  const mounted = useRef(false);
  return (
    <div
      ref={(el) => {
        if (el && !mounted.current) {
          mounted.current = true;
          onMount();
        }
      }}
      className='bs-row'
      style={{
        transform: `translateY(${row * ROW_H}px)`,
        visibility: visible ? 'visible' : 'hidden',
        borderLeftColor: `hsl(${HUES[position % HUES.length]} 70% 55%)`,
      }}
    >
      <span className='bs-pos'>#{position}</span> Dòng {row.toLocaleString('vi-VN')}
    </div>
  );
}

export default function BufferSetDemo() {
  const setRef = useRef(new BufferSet());
  const slotsRef = useRef<number[]>([]); // position → row
  const seen = useRef(new Set<number>());
  const mounts = useRef(0);
  const [slots, setSlots] = useState<number[]>([]);
  const [range, setRange] = useState<[number, number]>([0, 0]);
  const [moves, setMoves] = useState(0);
  const [mountCount, setMountCount] = useState(0);
  const { lines, add } = useLog(12);

  const update = (scrollTop: number) => {
    // đổi BufferSet ngoài setState: updater có thể bị gọi hai lần trong StrictMode
    const set = setRef.current;
    const next = slotsRef.current.slice();
    const first = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
    const last = Math.min(ROWS - 1, Math.floor((scrollTop + VIEW_H) / ROW_H) + OVERSCAN);
    let moved = 0;
    for (let row = first; row <= last; row++) {
      seen.current.add(row);
      if (set.positionOf(row) !== null) continue;
      if (set.size < MAX_NODES) {
        next[set.addNew(row)] = row;
        continue;
      }
      const position = set.replaceFurthest(first, last, row);
      if (position === null) continue;
      if (moved < 3) add(`dòng ${row} lấy chỗ #${position} (trước giữ dòng ${next[position]})`);
      next[position] = row;
      moved++;
    }
    slotsRef.current = next;
    setSlots(next);
    setMoves((m) => m + moved);
    setRange([first, last]);
  };

  useEffect(() => {
    if (slotsRef.current.length === 0) update(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setMountCount(mounts.current);
  }, [slots]);

  const heaps = setRef.current.heapSizes;

  return (
    <div className='page bs-demo'>
      <h1>Cặp min/max-heap: tái dùng node DOM trong danh sách ảo</h1>
      <p className='hint'>
        {ROWS.toLocaleString('vi-VN')} dòng nhưng chỉ có tối đa {MAX_NODES} node DOM. Dòng mới cần hiện thì lấy chỗ
        của dòng <b>xa vùng nhìn thấy nhất</b>: nhỏ nhất (min-heap) hoặc lớn nhất (max-heap). Màu viền là số chỗ:
        cuộn để thấy cùng một node đổi dòng.
      </p>
      <div className='stats'>
        <Stat label='node DOM (chỗ)' value={<output data-testid='bs-nodes'>{slots.length}</output>} />
        <Stat label='lần mount' value={<output data-testid='bs-mounts'>{mountCount}</output>} />
        <Stat label='dòng đã hiện' value={<output data-testid='bs-seen'>{seen.current.size}</output>} />
        <Stat label='lần đổi chỗ' value={moves} />
        <Stat label='entry trong min/max-heap' value={`${heaps.min}/${heaps.max}`} />
      </div>
      <div className='bs-split'>
        <div
          className='bs-scroll'
          style={{ height: VIEW_H }}
          onScroll={(e) => update(e.currentTarget.scrollTop)}
          data-testid='bs-scroll'
        >
          <div style={{ height: ROWS * ROW_H, position: 'relative' }}>
            {slots.map((row, position) => (
              <Slot
                key={position}
                position={position}
                row={row}
                visible={row >= range[0] && row <= range[1]}
                onMount={() => mounts.current++}
              />
            ))}
          </div>
        </div>
        <div>
          <p className='hint'>
            Nếu dùng <code>key=&#123;row&#125;</code>, mỗi dòng mới hiện là một lần mount: số lần mount sẽ bằng
            &quot;dòng đã hiện&quot;. Với key theo chỗ, số lần mount đứng yên ở {MAX_NODES}.
          </p>
          <Log lines={lines} />
        </div>
      </div>
    </div>
  );
}
