import { useEffect, useState } from 'react';
import { createPortalNode, InPortal, OutPortal, type PortalNode } from '../lib/reversePortal';
import { Log, Stat, useLog } from './shared';
import './ReversePortalDemo.css';

type Slot = 'gallery' | 'sidebar' | 'none';
type Mode = 'naive' | 'portal';

// đếm số INSTANCE khác nhau đã mount (StrictMode chạy effect 2 lần cho cùng một instance)
const mountedInstances = new Set<number>();
let nextInstanceId = 0;
let iframeLoads = 0;
const counterListeners = new Set<() => void>();
const bump = () => counterListeners.forEach((fn) => fn());

// iframe có JS riêng: đếm giây kể từ lúc tải. Tải lại = về 0.
// Màu lấy từ theme của trang một lần (đổi srcDoc là iframe tải lại).
let iframeDoc = '';
function getIframeDoc() {
  if (!iframeDoc) {
    const css = getComputedStyle(document.documentElement);
    const bg = css.getPropertyValue('--bg').trim();
    const muted = css.getPropertyValue('--muted').trim();
    iframeDoc = `<!doctype html><style>html,body{height:100%;margin:0}body{background:${bg};color:${muted};font:13px system-ui;display:grid;place-items:center}</style>
<div>iframe đã chạy <b id="t" style="color:#3ccf7a">0</b>s</div>
<script>let s=0;parent.postMessage('rp-iframe-load','*');setInterval(()=>{document.getElementById('t').textContent=++s},1000)</script>`;
  }
  return iframeDoc;
}

function CollectionWidget({ where }: { where?: string }) {
  const [saved, setSaved] = useState(0);
  const [mountedAt] = useState(() => new Date().toLocaleTimeString('vi-VN', { hour12: false }));
  const [instanceId] = useState(() => ++nextInstanceId);
  useEffect(() => {
    mountedInstances.add(instanceId);
    bump();
  }, [instanceId]);
  return (
    <div className='rp-widget'>
      <div className='rp-row'>
        <button className='primary' onClick={() => setSaved((n) => n + 1)}>
          ♥ Lưu vào bộ sưu tập ({saved})
        </button>
        <span className='muted'>mount lúc {mountedAt}</span>
      </div>
      <input type='text' placeholder='Ghi chú (gõ thử rồi đổi chỗ)…' aria-label='Ghi chú' />
      <iframe className='rp-iframe' title='Widget bên thứ ba' srcDoc={getIframeDoc()} />
      {where && <small className='muted'>props từ OutPortal: where = "{where}"</small>}
    </div>
  );
}

export default function ReversePortalDemo() {
  const [mode, setMode] = useState<Mode>('portal');
  const [slot, setSlot] = useState<Slot>('gallery');
  const [, force] = useState(0);
  const { lines, add } = useLog();
  const [node] = useState<PortalNode<{ where: string }>>(() => {
    const n = createPortalNode<{ where: string }>();
    const mount = n.mount;
    n.mount = (host) => {
      const how = mount(host);
      if (how !== 'noop')
        add(
          `mount bằng ${how === 'move' ? 'moveBefore (giữ nguyên iframe)' : 'appendChild'}`,
          how === 'move' ? 'ok' : 'warn',
        );
      return how;
    };
    return n;
  });

  useEffect(() => {
    const update = () => force((x) => x + 1);
    counterListeners.add(update);
    const onMessage = (e: MessageEvent) => {
      if (e.data === 'rp-iframe-load') {
        iframeLoads++;
        bump();
      }
    };
    window.addEventListener('message', onMessage);
    return () => {
      counterListeners.delete(update);
      window.removeEventListener('message', onMessage);
    };
  }, []);

  const move = (next: Slot) => {
    setSlot(next);
    add(`→ ${next === 'none' ? 'zoom: không chỗ nào hiển thị' : `đặt widget ở ${next}`}`);
  };
  const switchMode = (next: Mode) => {
    setMode(next);
    mountedInstances.clear();
    iframeLoads = 0;
    bump();
    add(
      next === 'naive'
        ? 'Cách ngây thơ: mỗi chỗ tự render widget'
        : 'Reverse portal: render một lần, di chuyển DOM',
      'muted',
    );
  };

  const widgetAt = (target: Slot) =>
    mode === 'naive'
      ? slot === target && <CollectionWidget />
      : slot === target && <OutPortal node={node} where={target} />;

  return (
    <div className='page'>
      <h1>Reverse portal: đổi chỗ mà không remount</h1>
      <p className='hint'>
        Bấm ♥ vài lần, gõ ghi chú, đợi iframe đếm vài giây, rồi đổi chỗ. Cách ngây thơ mất hết;
        reverse portal giữ nguyên cả state React lẫn iframe.
      </p>
      <div className='toolbar'>
        <label className='switch'>
          <input type='radio' checked={mode === 'naive'} onChange={() => switchMode('naive')} />{' '}
          Cách ngây thơ
        </label>
        <label className='switch'>
          <input type='radio' checked={mode === 'portal'} onChange={() => switchMode('portal')} />{' '}
          Reverse portal
        </label>
      </div>
      <div className='toolbar'>
        <button onClick={() => move('gallery')} aria-pressed={slot === 'gallery'}>
          Đặt ở gallery
        </button>
        <button onClick={() => move('sidebar')} aria-pressed={slot === 'sidebar'}>
          Đặt ở sidebar
        </button>
        <button onClick={() => move('none')} aria-pressed={slot === 'none'}>
          Bật zoom (ẩn cả hai)
        </button>
      </div>
      <div className='stats'>
        <Stat label='lần React mount widget' value={mountedInstances.size} />
        <Stat label='lần iframe tải' value={iframeLoads} />
      </div>

      {mode === 'portal' && (
        <InPortal node={node}>
          <CollectionWidget />
        </InPortal>
      )}

      <div className='rp-layout'>
        <section className='card rp-slot'>
          <h3>Gallery ảnh</h3>
          <div className='rp-photo'>👟</div>
          {widgetAt('gallery')}
        </section>
        <aside className='card rp-slot'>
          <h3>Sidebar</h3>
          <p className='muted'>Giá, size, nút mua…</p>
          {widgetAt('sidebar')}
        </aside>
      </div>
      <Log lines={lines} />
    </div>
  );
}
