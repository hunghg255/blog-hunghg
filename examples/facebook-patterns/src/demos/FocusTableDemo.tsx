import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import {
  applyRovingTabIndex,
  findCellByTag,
  focusElement,
  isProgrammaticFocus,
  nextPosition,
  supportsPreventScroll,
  type GridCell,
  type GridKey,
  type GridPosition,
} from '../lib/focusTable';
import { Log, Stat, useLog } from './shared';
import './FocusTableDemo.css';

/** Ô trong lịch tuần: mỗi hàng là một tuần, có hàng sự kiện kéo dài nhiều ngày (colSpan). */
interface CellSpec {
  label: string;
  colSpan?: number;
  disabled?: boolean;
  tag?: string;
}

const DAYS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
const ROWS: CellSpec[][] = [
  DAYS.map((d, i) => ({ label: `${d} ${i + 3}` })),
  [{ label: 'Hội thảo (T2–T4)', colSpan: 3, tag: 'event' }, { label: 'T5 trống' }, { label: 'Review (T6–CN)', colSpan: 3, tag: 'event' }],
  DAYS.map((d, i) => ({ label: `${d} ${i + 10}` })),
  DAYS.map((d) => ({ label: `${d} nghỉ`, disabled: true })), // tuần nghỉ: cả hàng disabled, bị bỏ qua
  DAYS.map((d, i) => ({ label: `${d} ${i + 24}` })),
  [{ label: 'T2 31' }, { label: 'Nghỉ lễ (T3–CN)', colSpan: 6, tag: 'event' }],
];
const KEYS: GridKey[] = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'];

function CalendarGrid({ add }: { add: (t: string, tone?: 'ok' | 'warn' | 'err' | 'muted') => void }) {
  const [rtl, setRtl] = useState(false);
  const [wrapX, setWrapX] = useState(false);
  const [wrapY, setWrapY] = useState(false);
  const [wrapXToNextLine, setWrapXToNextLine] = useState(true);
  const [pageJumpSize, setPageJumpSize] = useState(5);
  const [active, setActive] = useState<GridPosition>({ row: 0, index: 0 });
  const refs = useRef<(HTMLButtonElement | null)[][]>(ROWS.map((r) => r.map(() => null)));

  const grid = (): GridCell[][] =>
    ROWS.map((row, r) =>
      row.map((c, i) => ({ el: refs.current[r][i]!, colSpan: c.colSpan, disabled: c.disabled, tag: c.tag })),
    );

  useEffect(() => applyRovingTabIndex(grid(), active), [active]);

  const move = (pos: GridPosition | null, why: string) => {
    if (!pos) {
      add(`${why}: không có ô để đi (đứng yên)`, 'muted');
      return;
    }
    setActive(pos);
    focusElement(refs.current[pos.row][pos.index]!);
    add(`${why} → ${ROWS[pos.row][pos.index].label}`, 'ok');
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'e' && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      move(findCellByTag(grid(), active, 'event'), 'phím E (ô sự kiện gần nhất)');
      return;
    }
    if (!KEYS.includes(e.key as GridKey)) return;
    e.preventDefault(); // không để trang cuộn theo mũi tên/PageDown
    const ctrl = e.ctrlKey || e.metaKey;
    move(
      nextPosition(grid(), active, e.key as GridKey, { ctrl }, { rtl, wrapX, wrapY, wrapXToNextLine, pageJumpSize }),
      `${ctrl ? 'Ctrl+' : ''}${e.key}`,
    );
  };

  return (
    <section className='card'>
      <h2>Lưới phím 2D: lịch có ô gộp cột</h2>
      <div className='toolbar'>
        <label className='switch'>
          <input type='checkbox' checked={rtl} onChange={(e) => setRtl(e.target.checked)} /> RTL
        </label>
        <label className='switch'>
          <input type='checkbox' checked={wrapX} onChange={(e) => setWrapX(e.target.checked)} /> wrapX
        </label>
        <label className='switch'>
          <input type='checkbox' checked={wrapY} onChange={(e) => setWrapY(e.target.checked)} /> wrapY
        </label>
        <label className='switch'>
          <input type='checkbox' checked={wrapXToNextLine} onChange={(e) => setWrapXToNextLine(e.target.checked)} />{' '}
          sang dòng
        </label>
        <label className='switch'>
          PageDown nhảy{' '}
          <select value={pageJumpSize} onChange={(e) => setPageJumpSize(Number(e.target.value))}>
            {[1, 2, 5].map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>{' '}
          hàng
        </label>
      </div>
      <p className='hint'>
        Bấm vào một ô rồi dùng mũi tên, Home/End (Ctrl: đầu/cuối bảng), PageUp/PageDown, phím <kbd>E</kbd> để nhảy tới ô
        sự kiện gần nhất. Tab đi thẳng ra khỏi lưới vì chỉ một ô có <code>tabIndex=0</code>.
      </p>
      <div className='ft-grid' role='grid' aria-label='Lịch tháng' dir={rtl ? 'rtl' : 'ltr'} onKeyDown={onKeyDown}>
        {ROWS.map((row, r) => (
          <div role='row' className='ft-row' key={r}>
            {row.map((c, i) => (
              <button
                key={i}
                role='gridcell'
                ref={(el) => {
                  refs.current[r][i] = el;
                }}
                className={`ft-cell${c.tag ? ' ft-event' : ''}${active.row === r && active.index === i ? ' ft-active' : ''}`}
                style={{ gridColumn: `span ${c.colSpan ?? 1}` }}
                disabled={c.disabled}
                aria-disabled={c.disabled}
                onClick={() => {
                  setActive({ row: r, index: i });
                  add(`click → ${c.label}`, 'muted');
                }}
              >
                {c.label}
              </button>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

type Strategy = 'plain' | 'native' | 'fallback';

function FocusNoScroll({ add }: { add: (t: string, tone?: 'ok' | 'warn' | 'err' | 'muted') => void }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const itemsRef = useRef<(HTMLButtonElement | null)[]>([]);
  const [menuFor, setMenuFor] = useState<number | null>(null);
  const [shift, setShift] = useState<string>('—');
  const supported = useMemo(() => supportsPreventScroll(), []);

  const run = (strategy: Strategy) => {
    const box = boxRef.current!;
    const before = { box: box.scrollTop, page: window.scrollY };
    const target = itemsRef.current[34]!;
    if (strategy === 'plain') focusElement(target);
    else focusElement(target, { preventScroll: true, strategy: strategy === 'native' ? 'native-only' : 'fallback-only' });
    const moved = box.scrollTop - before.box + (window.scrollY - before.page);
    setShift(`${Math.round(moved)}px`);
    add(
      `focus mục 35 (${strategy}): khung cuộn ${Math.round(before.box)}→${Math.round(box.scrollTop)}px, trang ${Math.round(before.page)}→${Math.round(window.scrollY)}px`,
      moved === 0 ? 'ok' : 'warn',
    );
  };

  return (
    <section className='card'>
      <h2>Focus bằng code mà không làm cuộn</h2>
      <p className='hint'>
        Trình duyệt này {supported ? 'hỗ trợ' : 'KHÔNG hỗ trợ'} <code>focus(&#123; preventScroll &#125;)</code> (phát hiện
        bằng getter). Nút "…" chỉ hiện khi <b>người dùng</b> focus vào dòng; focus do code (cờ{' '}
        <code>isProgrammaticFocus()</code>) thì không.
      </p>
      <div className='toolbar'>
        <button onClick={() => run('plain')}>focus() thường</button>
        <button className='primary' onClick={() => run('native')}>
          preventScroll
        </button>
        <button onClick={() => run('fallback')}>lưu rồi trả vị trí cuộn</button>
        <button onClick={() => (boxRef.current!.scrollTop = 0)}>về đầu khung</button>
      </div>
      <div className='stats'>
        <Stat label='quãng bị cuộn' value={<output data-testid='ft-shift'>{shift}</output>} />
      </div>
      <div className='ft-list' ref={boxRef} data-testid='ft-list'>
        {Array.from({ length: 40 }, (_, i) => (
          <div className='ft-item' key={i}>
            <button
              ref={(el) => {
                itemsRef.current[i] = el;
              }}
              onFocus={() => setMenuFor(isProgrammaticFocus() ? null : i)}
              onBlur={() => setMenuFor(null)}
            >
              Thông báo {i + 1}
            </button>
            {menuFor === i && <span className='badge'>…</span>}
          </div>
        ))}
      </div>
    </section>
  );
}

export default function FocusTableDemo() {
  const { lines, add } = useLog(30);
  return (
    <div className='page'>
      <h1>Lưới phím mũi tên 2D và focus không cuộn</h1>
      <div className='ft-wrap'>
        <CalendarGrid add={add} />
        <FocusNoScroll add={add} />
      </div>
      <Log lines={lines} />
    </div>
  );
}
