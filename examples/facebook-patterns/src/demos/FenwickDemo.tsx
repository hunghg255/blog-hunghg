import { useMemo, useRef, useState } from 'react';
import { RowOffsets, SumTree, WeightedPicker } from '../lib/fenwick';
import { alea } from '../lib/seededRandom';
import { Stat } from './shared';
import './FenwickDemo.css';

const ITEMS = ['Bài A', 'Bài B', 'Bài C', 'Bài D', 'Bài E', 'Bài F'];
const DRAWS = 20000;

export default function FenwickDemo() {
  return (
    <div className='page fw-demo'>
      <h1>Cây tổng: rút thăm theo trọng số và vị trí dòng</h1>
      <p className='hint'>
        Một cây tổng nhị phân trong mảng trả lời hai câu hỏi trong O(log n): <b>tổng tiền tố</b> và{' '}
        <b>phần tử nào chứa vị trí v</b>. Câu thứ hai dùng cho rút thăm theo trọng số và cho &quot;dòng nào
        đang ở pixel y&quot; trong danh sách cao không đều.
      </p>
      <WeightedSection />
      <RowsSection />
    </div>
  );
}

function WeightedSection() {
  const [weights, setWeights] = useState([0.5, 0.5, 1.5, 2, 3.25, 0.25]);
  const [int32, setInt32] = useState(false);
  const [counts, setCounts] = useState<number[] | null>(null);
  const [timing, setTiming] = useState<string | null>(null);

  // bản gốc dùng Int32Array: trọng số lẻ bị cắt phần thập phân khi ghi vào mảng
  const effective = int32 ? weights.map((w) => Math.trunc(w)) : weights;
  const total = effective.reduce((a, b) => a + b, 0);

  const draw = () => {
    const picker = new WeightedPicker(effective, alea('demo', Date.now()));
    const c = new Array<number>(ITEMS.length).fill(0);
    let empty = 0;
    for (let i = 0; i < DRAWS; i++) {
      const k = picker.pick();
      if (k < 0) empty++;
      else c[k]++;
    }
    setCounts(empty === DRAWS ? null : c);
  };

  const benchmark = () => {
    const n = 100_000;
    const random = alea('bench');
    const w = Array.from({ length: n }, () => random() * 10);
    const tree = new SumTree(w);
    const rounds = 2000;
    // mỗi vòng: đổi một trọng số rồi rút một lần
    let t = performance.now();
    for (let r = 0; r < rounds; r++) {
      const i = Math.floor(random() * n);
      w[i] = random() * 10;
      let sum = 0;
      for (const x of w) sum += x;
      let target = random() * sum;
      let k = 0;
      while (k < n - 1 && target >= w[k]) target -= w[k++];
    }
    const linear = performance.now() - t;
    t = performance.now();
    for (let r = 0; r < rounds; r++) {
      const i = Math.floor(random() * n);
      tree.set(i, random() * 10);
      tree.greatestLowerBound(random() * tree.total());
    }
    const logn = performance.now() - t;
    setTiming(`${rounds} lần (đổi 1 trọng số + rút) trên ${n.toLocaleString('vi-VN')} phần tử: duyệt tuyến tính ${linear.toFixed(0)}ms, cây tổng ${logn.toFixed(1)}ms`);
  };

  return (
    <section className='card fw-card'>
      <h2>1. Rút thăm theo trọng số</h2>
      <div className='fw-weights'>
        {ITEMS.map((name, i) => (
          <label key={name}>
            <span>{name}</span>
            <input
              type='range'
              min={0}
              max={5}
              step={0.25}
              value={weights[i]}
              onChange={(e) => {
                const next = weights.slice();
                next[i] = Number(e.target.value);
                setWeights(next);
                setCounts(null);
              }}
            />
            <b>{weights[i].toFixed(2)}</b>
          </label>
        ))}
      </div>
      <div className='toolbar'>
        <button className='primary' onClick={draw}>
          Rút {DRAWS.toLocaleString('vi-VN')} lần
        </button>
        <label>
          <input type='checkbox' checked={int32} onChange={(e) => (setInt32(e.target.checked), setCounts(null))} />{' '}
          Lưu như bản gốc (Int32Array)
        </label>
        <button onClick={benchmark}>So tốc độ với duyệt tuyến tính</button>
      </div>
      {total === 0 && <p className='err'>Tổng trọng số = 0: không rút được phần tử nào.</p>}
      <table className='fw-table' data-testid='fw-table'>
        <thead>
          <tr>
            <th>Mục</th>
            <th>Trọng số lưu</th>
            <th>Kỳ vọng</th>
            <th>Thực tế</th>
          </tr>
        </thead>
        <tbody>
          {ITEMS.map((name, i) => {
            const expected = total ? effective[i] / total : 0;
            const actual = counts ? counts[i] / DRAWS : null;
            return (
              <tr key={name}>
                <td>{name}</td>
                <td className={int32 && effective[i] !== weights[i] ? 'warn' : ''}>{effective[i]}</td>
                <td>{(expected * 100).toFixed(1)}%</td>
                <td>
                  {actual === null ? '—' : `${(actual * 100).toFixed(1)}%`}
                  {actual !== null && <i className='fw-bar' style={{ width: `${actual * 100}%` }} />}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {timing && (
        <p className='hint' data-testid='fw-timing'>
          {timing}
        </p>
      )}
    </section>
  );
}

const ROWS = 100_000;
const VIEW_H = 260;

function rowHeight(i: number) {
  // chiều cao "thật" giả lập: 24–90px, cố định theo chỉ số dòng
  return 24 + ((i * 2654435761) % 67);
}

function RowsSection() {
  const offsets = useMemo(() => {
    const o = new RowOffsets(ROWS, 40);
    return o;
  }, []);
  const measured = useRef(new Set<number>());
  const [scrollTop, setScrollTop] = useState(0);
  const [jump, setJump] = useState('1234567');
  const [found, setFound] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  // đo lười: chỉ dòng sắp hiện mới được set chiều cao thật vào cây (giống FixedDataTableScrollHelper)
  const visible = useMemo(() => {
    let { row } = offsets.rowAt(scrollTop);
    const out: Array<{ row: number; top: number; height: number }> = [];
    while (row < ROWS) {
      if (!measured.current.has(row)) {
        offsets.setHeight(row, rowHeight(row));
        measured.current.add(row);
      }
      const top = offsets.top(row);
      if (top > scrollTop + VIEW_H) break;
      out.push({ row, top, height: offsets.height(row) });
      row++;
    }
    return out;
  }, [scrollTop, offsets]);

  const first = offsets.rowAt(scrollTop);

  return (
    <section className='card fw-card'>
      <h2>2. 100.000 dòng cao không đều</h2>
      <p className='hint'>
        Mỗi dòng ước lượng 40px, đo thật (24–90px) khi sắp hiện rồi ghi vào cây. Vị trí một dòng = tổng tiền tố;
        dòng ở pixel y = greatestLowerBound(y).
      </p>
      <div className='stats'>
        <Stat label='dòng đầu' value={<output data-testid='fw-first'>{first.row}</output>} />
        <Stat label='đã cuộn qua dòng đó' value={`${first.offset.toFixed(0)}px`} />
        <Stat label='dòng đã đo' value={measured.current.size} />
        <Stat label='tổng chiều cao' value={`${Math.round(offsets.contentHeight()).toLocaleString('vi-VN')}px`} />
      </div>
      <div
        ref={boxRef}
        className='fw-scroll'
        style={{ height: VIEW_H }}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        data-testid='fw-scroll'
      >
        <div style={{ height: offsets.contentHeight(), position: 'relative' }}>
          {visible.map(({ row, top, height }) => (
            <div key={row} className='fw-row' style={{ top, height }}>
              Dòng {row} · cao {height}px
            </div>
          ))}
        </div>
      </div>
      <div className='toolbar'>
        <label>
          Pixel y:{' '}
          <input value={jump} onChange={(e) => setJump(e.target.value)} inputMode='numeric' size={10} />
        </label>
        <button
          onClick={() => {
            const y = Math.max(0, Number(jump) || 0);
            const r = offsets.rowAt(y);
            setFound(`pixel ${y.toLocaleString('vi-VN')} thuộc dòng ${r.row} (đã vào ${r.offset.toFixed(0)}px)`);
            if (boxRef.current) boxRef.current.scrollTop = y;
          }}
        >
          Tìm dòng và cuộn tới
        </button>
      </div>
      {found && <p data-testid='fw-found'>{found}</p>}
    </section>
  );
}
