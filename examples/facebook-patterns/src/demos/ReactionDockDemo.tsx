import { useRef, useState } from 'react';
import { usePressSlide } from '../lib/reactionDock';
import { Log, useLog } from './shared';
import './ReactionDockDemo.css';

const REACTIONS = ['like', 'love', 'haha', 'wow', 'sad', 'angry'] as const;
type Reaction = (typeof REACTIONS)[number];
const META: Record<Reaction, { emoji: string; label: string; color: string }> = {
  like: { emoji: '👍', label: 'Thích', color: '#2078f4' },
  love: { emoji: '❤️', label: 'Yêu thích', color: '#f33e58' },
  haha: { emoji: '😆', label: 'Haha', color: '#f7b125' },
  wow: { emoji: '😮', label: 'Wow', color: '#f7b125' },
  sad: { emoji: '😢', label: 'Buồn', color: '#f7b125' },
  angry: { emoji: '😡', label: 'Phẫn nộ', color: '#e9710f' },
};
const HEADER = 48;

interface Settings {
  block: boolean;
  hitTest: 'closest' | 'parent';
  hover: boolean;
}

function Post({ title, settings, log }: { title: string; settings: Settings; log: (t: string, tone?: 'ok' | 'warn') => void }) {
  const [current, setCurrent] = useState<Reaction | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  const { open, animating, placement, hovered, triggerProps, dockProps, itemProps } = usePressSlide({
    items: REACTIONS,
    current,
    onSelect(item, how) {
      setCurrent(item);
      log(`${title}: ${item ? META[item].label : 'bỏ cảm xúc'} (${how})`, 'ok');
    },
    blockClicksWhileAnimating: settings.block,
    hitTest: settings.hitTest,
    openOnHoverMs: settings.hover ? 500 : null,
    topInset: HEADER,
    dockRef,
    triggerRef,
  });

  const meta = current ? META[current] : null;
  return (
    <article className='rd-post card'>
      <p>
        <b>{title}</b>
      </p>
      <div className='rd-anchor'>
        {open && (
          <div
            ref={dockRef}
            className={`rd-dock rd-${placement}${animating ? ' rd-animating' : ''}`}
            data-testid='dock'
            {...dockProps}
          >
            {REACTIONS.map((r, i) => (
              <button key={r} type='button' className={`rd-item${hovered === r ? ' rd-hover' : ''}`} aria-label={META[r].label} {...itemProps(r, i)}>
                <span className='rd-face'>
                  <span className='rd-glyph'>{META[r].emoji}</span>
                </span>
                <span className='rd-label'>{META[r].label}</span>
              </button>
            ))}
          </div>
        )}
        <button
          ref={triggerRef}
          type='button'
          className='rd-trigger'
          style={meta ? { color: meta.color } : undefined}
          data-testid='trigger'
          {...triggerProps}
        >
          {meta ? `${meta.emoji} ${meta.label}` : '👍 Thích'}
        </button>
      </div>
    </article>
  );
}

export default function ReactionDockDemo() {
  const [settings, setSettings] = useState<Settings>({ block: true, hitTest: 'closest', hover: false });
  const [rtl, setRtl] = useState(false);
  const { lines, add } = useLog(30);
  const set = (patch: Partial<Settings>) => setSettings((s) => ({ ...s, ...patch }));

  return (
    <div className='page reaction-dock' dir={rtl ? 'rtl' : 'ltr'}>
      <div className='rd-header' style={{ height: HEADER }}>
        Thanh điều hướng cố định ({HEADER}px)
      </div>
      <h1>Bảng reaction nhấn giữ rồi trượt</h1>
      <p className='hint'>
        Nhấn giữ nút Thích (chuột hoặc ngón tay) rồi trượt sang cảm xúc, thả tay để chọn. Bấm nhanh = Thích. Bàn phím: focus
        nút, <kbd>↑</kbd> mở bảng, <kbd>←</kbd>/<kbd>→</kbd> chọn, <kbd>Enter</kbd> xác nhận, <kbd>Esc</kbd> đóng. Cuộn để một bài nằm sát thanh điều hướng rồi mở bảng: bảng tự lật xuống dưới nút.
      </p>
      <div className='toolbar rd-settings'>
        <label className='switch'>
          <input type='checkbox' checked={settings.block} onChange={(e) => set({ block: e.target.checked })} /> Chặn click
          200ms đầu
        </label>
        <label className='switch'>
          <input type='checkbox' checked={settings.hover} onChange={(e) => set({ hover: e.target.checked })} /> Mở khi rê
          chuột 500ms
        </label>
        <label className='switch'>
          <input
            type='checkbox'
            checked={settings.hitTest === 'parent'}
            onChange={(e) => set({ hitTest: e.target.checked ? 'parent' : 'closest' })}
          />{' '}
          Dò ô kiểu bản gốc (chỉ 1 cấp cha)
        </label>
        <label className='switch'>
          <input type='checkbox' checked={rtl} onChange={(e) => setRtl(e.target.checked)} /> Giao diện RTL
        </label>
      </div>
      <Post title='Bài viết 1' settings={settings} log={add} />
      <Log lines={lines} />
      <Post title='Bài viết 2' settings={settings} log={add} />
      <Post title='Bài viết 3' settings={settings} log={add} />
    </div>
  );
}
