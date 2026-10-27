import { useRef, useState } from 'react';
import { createResilientLoader, sentinelRule, type LoaderEvent } from '../lib/resilientLoader';
import { Log, useLog } from './shared';

declare global {
  interface Window {
    __resilientDemoLoaded?: string[];
  }
}

let seq = 0;

/** "CDN giả": `failures` lần đầu trả về URL hỏng (blob đã thu hồi), sau đó trả file thật. */
function flakyCdn(name: string, failures: number) {
  const id = `${name}-${seq++}`;
  const good = URL.createObjectURL(
    new Blob([`(window.__resilientDemoLoaded ||= []).push(${JSON.stringify(id)});`], { type: 'text/javascript' }),
  );
  return (attempt: number) => {
    if (attempt >= failures) return good;
    const broken = URL.createObjectURL(new Blob(['']));
    URL.revokeObjectURL(broken); // tải URL đã thu hồi -> lỗi mạng -> onerror
    return broken;
  };
}

function describe(event: LoaderEvent) {
  switch (event.type) {
    case 'preload':
      return `${event.name}: <link rel=preload>`;
    case 'attempt':
      return `${event.name}: thử lần ${event.attempt + 1}`;
    case 'retry':
      return `${event.name}: lỗi, thử lại sau ${event.delay}ms`;
    case 'breaker-open':
      return `🔌 ${event.name}: nhiều file lỗi cùng lúc -> NGẮT retry cho cả trang`;
    case 'success':
      return `✅ ${event.name}: tải xong sau ${event.attempts} lần (${event.ms}ms)`;
    case 'error':
      return `❌ ${event.name}: bỏ cuộc sau ${event.attempts} lần (${event.ms}ms)`;
    case 'css-applied':
      return `🎨 ${event.name}: CSS đã áp dụng sau ${event.ms}ms`;
    case 'css-timeout':
      return `⏱ ${event.name}: không thấy sentinel sau ${event.ms}ms`;
  }
}

const tone = (event: LoaderEvent) =>
  event.type === 'success' || event.type === 'css-applied'
    ? 'ok'
    : event.type === 'error' || event.type === 'breaker-open' || event.type === 'css-timeout'
      ? 'err'
      : event.type === 'retry'
        ? 'warn'
        : 'muted';

export default function ResilientLoadingDemo() {
  const { lines, add, clear } = useLog(80);
  const [themed, setThemed] = useState(false);
  // Demo dùng cửa sổ ngắt mạch 50ms (Facebook: 5ms) để kết quả ổn định trên mọi máy.
  const makeLoader = () =>
    createResilientLoader({
      breakerWindowMs: 50,
      cssTimeoutMs: 2000,
      onEvent: (event) => add(describe(event), tone(event)),
    });
  const loaderRef = useRef(makeLoader());

  const fresh = () => {
    clear();
    loaderRef.current = makeLoader();
    return loaderRef.current;
  };

  const runScripts = (scenario: [string, number][]) => {
    const loader = fresh();
    scenario.forEach(([name, failures]) => {
      loader.loadScript(name, flakyCdn(name, failures)).catch(() => {});
    });
  };

  const loadCss = (withSentinel: boolean) => {
    const loader = fresh();
    setThemed(false);
    const name = withSentinel ? 'theme' : 'theme-no-sentinel';
    const css = `.rl-box{background:var(--accent);color:#fff;border-color:transparent}${withSentinel ? sentinelRule(name) : ''}`;
    const href = URL.createObjectURL(new Blob([css], { type: 'text/css' }));
    loader
      .loadStyle(name, href, { detect: 'sentinel' })
      .then(() => setThemed(true))
      .catch(() => {});
  };

  return (
    <div className='page'>
      <h1>Tải JS/CSS bền bỉ</h1>
      <p className='hint'>
        Retry sau 200ms rồi 500ms. "Mất mạng" làm 4 file lỗi gần như cùng lúc: cầu dao ngắt, không
        retry nữa. CSS dùng sentinel: biết chắc rule đã được áp dụng chứ không chỉ "đã tải".
      </p>
      <div className='toolbar'>
        <button onClick={() => runScripts([['chunk-a', 0]])}>Chunk ổn định</button>
        <button onClick={() => runScripts([['chunk-b', 1]])}>CDN chập chờn (lỗi 1 lần)</button>
        <button onClick={() => runScripts([['chunk-c', 2]])}>Lỗi 2 lần</button>
        <button onClick={() => runScripts([['chunk-d', 99]])}>Lỗi mãi</button>
        <button
          className='primary'
          onClick={() =>
            runScripts([
              ['feed', 99],
              ['chat', 99],
              ['photos', 99],
              ['ads', 99],
            ])
          }
        >
          Mất mạng (4 file cùng lỗi)
        </button>
      </div>
      <div className='toolbar'>
        <button onClick={() => loadCss(true)}>Tải CSS có sentinel</button>
        <button onClick={() => loadCss(false)}>Tải CSS thiếu sentinel</button>
        <span className='muted'>Trạng thái:</span>
        <output className='card rl-box' data-testid='rl-box' style={{ padding: '6px 12px', borderStyle: 'dashed' }}>
          {themed ? 'CSS đã áp dụng' : 'Chưa có CSS'}
        </output>
      </div>
      <Log lines={lines} />
    </div>
  );
}
