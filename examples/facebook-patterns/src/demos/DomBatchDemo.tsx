import { useMemo, useRef, useState } from 'react';
import { createDomBatcher, type KeyPolicy } from '../lib/domBatch';
import { createLayoutContext } from '../lib/layoutContext';
import { Log, Stat, useLog } from './shared';
import './DomBatchDemo.css';

const CARDS = 400;
const TEXT = 'Một đoạn chữ đủ dài để xuống dòng, nên trình duyệt phải tính lại vị trí từng dòng.';

function Thrashing({ add }: { add: (t: string, tone?: 'ok' | 'warn' | 'err' | 'muted') => void }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [times, setTimes] = useState({ naive: '—', batched: '—' });
  const [narrow, setNarrow] = useState(false);

  /** Đổi bề rộng khung để layout bị "bẩn", rồi đo thời gian chỉnh chiều cao 300 thẻ. */
  const run = (mode: 'naive' | 'batched') => {
    const box = boxRef.current!;
    const cards = Array.from(box.querySelectorAll<HTMLElement>('.db-card'));
    const next = !narrow;
    setNarrow(next);
    // bảng: đổi một ô là trình duyệt phải tính lại cả bảng, nên mỗi lần ép layout rất đắt
    box.style.width = next ? '70%' : '100%';
    const t0 = performance.now();
    if (mode === 'naive') {
      // đọc-ghi xen kẽ: mỗi lần đọc offsetWidth sau một lần ghi style là một lần layout đồng bộ
      for (const card of cards) {
        const w = card.offsetWidth;
        card.style.height = `${Math.round(w / 6)}px`;
      }
      const ms = performance.now() - t0;
      setTimes((t) => ({ ...t, naive: `${ms.toFixed(1)}ms` }));
      add(`xen kẽ đọc/ghi ${cards.length} ô: ${ms.toFixed(1)}ms`, 'warn');
    } else {
      // gom: một batcher riêng chạy flush() đồng bộ để đo trong cùng tick
      const batcher = createDomBatcher({ raf: () => {} });
      for (const card of cards) {
        batcher.schedule(
          () => card.offsetWidth,
          (w) => {
            card.style.height = `${Math.round(w / 6)}px`;
          },
        );
      }
      batcher.flush();
      const ms = performance.now() - t0;
      setTimes((t) => ({ ...t, batched: `${ms.toFixed(1)}ms` }));
      add(`đọc hết rồi ghi hết ${cards.length} ô: ${ms.toFixed(1)}ms (${batcher.stats.rounds} vòng)`, 'ok');
    }
  };

  return (
    <section className='card'>
      <h2>Layout thrashing: bảng {CARDS} hàng đổi chiều cao theo bề rộng</h2>
      <div className='toolbar'>
        <button onClick={() => run('naive')}>Đọc/ghi xen kẽ</button>
        <button className='primary' onClick={() => run('batched')}>
          Đọc trước, ghi sau
        </button>
      </div>
      <div className='stats'>
        <Stat label='xen kẽ' value={<output data-testid='db-naive'>{times.naive}</output>} />
        <Stat label='gom theo frame' value={<output data-testid='db-batched'>{times.batched}</output>} />
      </div>
      <div className='db-box' ref={boxRef}>
        <table className='db-table'>
          <tbody>
            {Array.from({ length: CARDS }, (_, i) => (
              <tr key={i}>
                <td className='db-card'>
                  <b>{i + 1}</b> {TEXT}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function KeyPolicyDemo({ add }: { add: (t: string, tone?: 'ok' | 'warn' | 'err' | 'muted') => void }) {
  const [policy, setPolicy] = useState<KeyPolicy>('first');
  const [applied, setApplied] = useState('—');
  const batcher = useMemo(() => createDomBatcher({ keyPolicy: policy }), [policy]);

  /** Trong cùng một frame, gọi 3 lần với cùng key "badge" và giá trị 1, 2, 3. */
  const burst = () => {
    for (const n of [1, 2, 3]) {
      batcher.schedule(
        () => n,
        (v) => {
          setApplied(String(v));
          add(`key "badge" (${policy}) → áp giá trị ${v}`, policy === 'last' ? 'ok' : 'warn');
        },
        'badge',
      );
    }
  };

  return (
    <section className='card'>
      <h2>Chống trùng theo key trong một frame</h2>
      <p className='hint'>
        Gọi 3 lần liền với cùng key và giá trị 1, 2, 3. Facebook giữ lần gọi <b>đầu tiên</b>; nếu dữ liệu nằm trong
        closure thì bị cũ. Giữ lần <b>cuối</b> thì ra giá trị mới nhất.
      </p>
      <div className='toolbar'>
        <label className='switch'>
          <input type='radio' checked={policy === 'first'} onChange={() => setPolicy('first')} /> giữ lần đầu (Facebook)
        </label>
        <label className='switch'>
          <input type='radio' checked={policy === 'last'} onChange={() => setPolicy('last')} /> giữ lần cuối
        </label>
        <button className='primary' onClick={burst}>
          Gọi 3 lần
        </button>
      </div>
      <div className='stats'>
        <Stat label='giá trị được áp' value={<output data-testid='db-applied'>{applied}</output>} />
      </div>
    </section>
  );
}

const ButtonGroup = createLayoutContext<string>();

function GroupButton({ label }: { label: string }) {
  const [layout, ref] = ButtonGroup.useLayout(label);
  const cls = layout ? `${layout.isFirst ? ' db-first' : ''}${layout.isLast ? ' db-last' : ''}` : '';
  return (
    <button ref={ref} className={`db-seg${cls}`} data-index={layout?.index}>
      {label}
      {layout && <small> {layout.index + 1}/{layout.total}</small>}
    </button>
  );
}

function LayoutContextDemo() {
  const [showMiddle, setShowMiddle] = useState(true);
  const [reversed, setReversed] = useState(false);
  const items = ['Ngày', 'Tuần', 'Tháng'];
  const order = reversed ? [...items].reverse() : items;
  return (
    <section className='card'>
      <h2>Con tự biết mình đứng đầu/cuối</h2>
      <p className='hint'>
        Mỗi nút tự bo góc nếu là nút đầu/cuối và tự biết thứ tự, kể cả khi bị bọc trong <code>&lt;span&gt;</code> hay ẩn
        hiện. Cha không truyền prop index.
      </p>
      <div className='toolbar'>
        <button onClick={() => setShowMiddle((v) => !v)}>{showMiddle ? 'Ẩn' : 'Hiện'} nút giữa</button>
        <button onClick={() => setReversed((v) => !v)}>Đảo thứ tự</button>
      </div>
      <div className='db-group' data-testid='db-group'>
        <ButtonGroup.Provider>
          {order.map((label) =>
            label === 'Tuần' ? (
              showMiddle && (
                <span key={label}>
                  <GroupButton label={label} />
                </span>
              )
            ) : (
              <GroupButton key={label} label={label} />
            ),
          )}
        </ButtonGroup.Provider>
      </div>
    </section>
  );
}

export default function DomBatchDemo() {
  const { lines, add } = useLog(30);
  return (
    <div className='page'>
      <h1>Đọc trước, ghi sau trong một frame</h1>
      <div className='db-wrap'>
        <Thrashing add={add} />
        <KeyPolicyDemo add={add} />
        <LayoutContextDemo />
      </div>
      <Log lines={lines} />
    </div>
  );
}
