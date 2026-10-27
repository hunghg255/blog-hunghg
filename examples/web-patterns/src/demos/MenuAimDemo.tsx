import { useLayoutEffect, useRef, useState } from 'react';
import { useMenuAim } from '../lib/menuAim';
import { Log, Stat, useLog } from './shared';
import './MenuAimDemo.css';

const CATEGORIES: Array<[string, string[]]> = [
  ['Lập trình', ['JavaScript', 'TypeScript', 'React', 'Node.js', 'Go', 'Rust']],
  ['Thiết kế', ['Figma', 'UI/UX', 'Màu sắc', 'Typography', 'Motion']],
  ['Kinh doanh', ['Khởi nghiệp', 'Bán hàng', 'Quản lý', 'Tài chính']],
  ['Marketing', ['SEO', 'Quảng cáo', 'Nội dung', 'Email', 'Mạng xã hội']],
  ['Nhiếp ảnh', ['Chân dung', 'Phong cảnh', 'Lightroom', 'Điện thoại']],
  ['Âm nhạc', ['Guitar', 'Piano', 'Sản xuất nhạc', 'Thanh nhạc']],
];

type Mode = 'naive' | 'aim';

export default function MenuAimDemo() {
  const [mode, setMode] = useState<Mode>('aim');
  const [debug, setDebug] = useState(true);
  const [active, setActive] = useState(0);
  const [switches, setSwitches] = useState(0);
  const { lines, add } = useLog(30);
  const itemRefs = useRef<Array<HTMLLIElement | null>>([]);
  const triggerRef = useRef<HTMLElement | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const activeRef = useRef(0);
  const activate = (index: number, via: string) => {
    if (activeRef.current === index) return;
    activeRef.current = index;
    setActive(index);
    setSwitches((n) => n + 1);
    add(`mở "${CATEGORIES[index][0]}" (${via})`, via === 'hover' ? undefined : 'muted');
  };

  const aim = useMenuAim({
    triggerRef,
    menuRef,
    debug,
    onAimEnd: ({ x, y }) => {
      // tam giác vừa bị gỡ: chuột đang nằm trên mục nào thì mở mục đó (chuột không động đậy
      // nên trình duyệt có thể chưa phát mouseover cho phần tử vừa lộ ra)
      const item = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-index]');
      if (item) activate(Number(item.dataset.index), 'sau khi gỡ tam giác');
    },
  });

  // submenu của mục mới đã render -> tính lại 2 tam giác
  const { update } = aim;
  useLayoutEffect(() => {
    triggerRef.current = itemRefs.current[active];
  }, [active]);
  useLayoutEffect(() => {
    if (mode === 'aim') update();
  }, [active, mode, update]);

  return (
    <div className='page ma-demo'>
      <h1>menuAim: rê chéo vào submenu</h1>
      <p className='hint'>
        Rê chuột vào "Lập trình" rồi đi chéo xuống các mục bên phải của submenu (vd "Rust"). Cách ngây thơ đổi sang
        "Kinh doanh", "Marketing"… ngay khi chuột lướt qua. Có menuAim thì hai tam giác (tô cam) che các mục đó trong lúc
        bạn đang nhắm.
      </p>
      <div className='toolbar'>
        <button className={mode === 'naive' ? 'primary' : ''} onClick={() => setMode('naive')}>
          Ngây thơ (đổi ngay khi hover)
        </button>
        <button className={mode === 'aim' ? 'primary' : ''} onClick={() => setMode('aim')}>
          menuAim
        </button>
        <label className='switch'>
          <input type='checkbox' checked={debug} onChange={(e) => setDebug(e.target.checked)} /> Hiện tam giác
        </label>
      </div>
      <div className='stats'>
        <Stat label='lần đổi mục' value={switches} />
        <Stat label='đang mở' value={CATEGORIES[active][0]} />
      </div>

      <div className='ma-menu'>
        <ul className='ma-list' role='menu'>
          {CATEGORIES.map(([name], i) => (
            <li
              key={name}
              ref={(el) => {
                itemRefs.current[i] = el;
              }}
              data-index={i}
              role='menuitem'
              tabIndex={0}
              className={i === active ? 'active' : ''}
              onMouseEnter={() => {
                // như Udemy: mỗi lần chuột vào trigger đều tính lại tam giác (kể cả mục đang mở)
                if (i === activeRef.current && mode === 'aim') update();
                activate(i, 'hover');
              }}
              onFocus={() => activate(i, 'bàn phím')}
            >
              {name} <span aria-hidden='true'>›</span>
            </li>
          ))}
        </ul>
        <div className='ma-sub' ref={menuRef}>
          {mode === 'aim' && aim.aimArea}
          <div className='ma-sub-title'>{CATEGORIES[active][0]}</div>
          <div className='ma-sub-grid'>
            {CATEGORIES[active][1].map((s) => (
              <a key={s} href='#/menu-aim' onClick={(e) => e.preventDefault()}>
                {s}
              </a>
            ))}
          </div>
        </div>
      </div>
      <Log lines={lines} />
    </div>
  );
}
