import { useEffect, useRef, useState } from 'react';
import { checkAll, resolvePath, snapshotNatives, xor1, type IntegrityResult } from '../lib/nativeHookCheck';
import { Log, useLog } from './shared';
import './NativeHookDemo.css';

const PATHS = ['fetch', 'XMLHttpRequest.prototype.open', 'EventTarget.prototype.addEventListener', 'JSON.stringify'];

type HookKind = 'naive' | 'fb-style';

/**
 * "Trang mô phỏng" là một iframe cùng origin: hook được cài vào đó, không làm hỏng trang demo.
 * Tải lại = tạo iframe mới, mọi hook biến mất.
 */
function createVictim(host: HTMLElement) {
  host.replaceChildren();
  const iframe = document.createElement('iframe');
  iframe.title = 'Trang mô phỏng';
  iframe.className = 'nh-victim';
  host.appendChild(iframe);
  const win = iframe.contentWindow as Window & typeof globalThis;
  // chụp tham chiếu ngay khi "trang" khởi động, trước mọi script bên thứ ba
  const snap = snapshotNatives({ fetch: 'fetch' }, win);
  return { win, snap };
}

/** Bọc một hàm của trang mô phỏng, đúng kiểu ClickRefLogger làm (để có cái mà dò). */
function installHook(win: Window, path: string, kind: HookKind, onCall: (path: string) => void) {
  const { holder, key, value } = resolvePath(win, path);
  if (!holder || typeof value !== 'function') return;
  const original = value as (...args: unknown[]) => unknown;
  if (kind === 'naive') {
    (holder as Record<string, unknown>)[key] = function (this: unknown, ...args: unknown[]) {
      onCall(path);
      return original.apply(this, args);
    };
    return;
  }
  // kiểu bản gốc: ghi nhận bất đồng bộ, giả toString, khoá thuộc tính bằng configurable:false
  const wrapper = function (this: unknown) {
    // eslint-disable-next-line prefer-rest-params
    const args = arguments;
    win.setTimeout(() => onCall(path), 0);
    return original.apply(this, args as unknown as unknown[]);
  };
  wrapper.toString = original.toString.bind(original);
  Object.defineProperty(holder, key, { configurable: false, writable: true, value: wrapper });
}

export default function NativeHookDemo() {
  const hostRef = useRef<HTMLDivElement>(null);
  const victimRef = useRef<ReturnType<typeof createVictim> | null>(null);
  const [results, setResults] = useState<IntegrityResult[]>([]);
  const [naiveView, setNaiveView] = useState<Array<{ path: string; looksNative: boolean }>>([]);
  const [hooks, setHooks] = useState<string>('chưa có');
  const [encoded, setEncoded] = useState('jiri,qnru,islg');
  const { lines, add, clear } = useLog(30);

  const reset = () => {
    if (!hostRef.current) return;
    victimRef.current = createVictim(hostRef.current);
    setHooks('chưa có');
    setResults([]);
    setNaiveView([]);
    add('Tải lại trang mô phỏng: không còn hook nào', 'muted');
  };

  useEffect(() => {
    reset();
    // chỉ tạo khi mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hook = (kind: HookKind) => {
    const victim = victimRef.current;
    if (!victim) return;
    if (hooks !== 'chưa có') reset();
    const v = victimRef.current!;
    PATHS.slice(0, 3).forEach((p) => installHook(v.win, p, kind, (path) => add(`hook ghi nhận lời gọi ${path}`, 'warn')));
    setHooks(kind === 'naive' ? 'hook ngây thơ' : 'hook kiểu bản gốc (giả toString)');
    add(`Đã cài ${kind === 'naive' ? 'hook ngây thơ' : 'hook giả toString'} vào fetch, XHR.open, addEventListener`, 'warn');
  };

  const run = () => {
    const victim = victimRef.current;
    if (!victim) return;
    // kiểm tra ngây thơ: hỏi chính hàm đó in ra gì
    setNaiveView(
      PATHS.map((p) => {
        const fn = resolvePath(victim.win, p).value as { toString(): string };
        return { path: p, looksNative: String(fn.toString()).includes('[native code]') };
      }),
    );
    const r = checkAll(PATHS, victim.win);
    setResults(r);
    const bad = r.filter((x) => !x.ok).map((x) => x.path);
    add(bad.length ? `Kiểm tra realm sạch: nghi bị bọc → ${bad.join(', ')}` : 'Kiểm tra realm sạch: không thấy dấu hiệu bị bọc', bad.length ? 'err' : 'ok');
  };

  const callFetch = async () => {
    const victim = victimRef.current;
    if (!victim) return;
    await victim.win.fetch('data:text/plain,xin%20chao').then((r) => r.text());
    add('Trang mô phỏng gọi fetch(data:…)', 'muted');
  };

  const checkSnapshot = () => {
    const victim = victimRef.current;
    if (!victim) return;
    const r = checkAll(['fetch'], victim.win);
    const snapNative = String(Function.prototype.toString.call(victim.snap.fetch)).includes('native code');
    add(
      `Bản fetch chụp lúc khởi động: ${snapNative ? 'vẫn là hàm native (đã bind)' : 'không phải native'}; window.fetch hiện tại: ${r[0].ok ? 'sạch' : 'bị bọc'}`,
      snapNative ? 'ok' : 'err',
    );
  };

  return (
    <div className='page nh-demo'>
      <h1>Kiểm tra API native có bị bọc không</h1>
      <p className='hint'>
        Cài hook vào "trang mô phỏng" (một iframe), rồi chạy kiểm tra. Hook kiểu bản gốc giả <code>toString</code> nên
        cách hỏi <code>fn.toString()</code> bị lừa; kiểm tra bằng realm sạch thì không.
      </p>
      <div className='toolbar'>
        <button onClick={() => hook('naive')}>Cài hook ngây thơ</button>
        <button onClick={() => hook('fb-style')}>Cài hook giả toString</button>
        <button onClick={callFetch}>Trang gọi fetch</button>
        <button className='primary' onClick={run}>
          Chạy kiểm tra
        </button>
        <button onClick={checkSnapshot}>Kiểm tra bản đã chụp</button>
        <button onClick={reset}>↺ Tải lại trang mô phỏng</button>
      </div>
      <p className='muted' data-testid='hook-state'>
        Hook hiện tại: {hooks}
      </p>
      <div ref={hostRef} className='nh-host' />

      {results.length > 0 && (
        <div className='nh-table-wrap'>
          <table className='nh-table'>
            <thead>
              <tr>
                <th>API</th>
                <th>fn.toString() có [native code]?</th>
                <th>Realm sạch</th>
                <th>Chi tiết</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r) => {
                const naive = naiveView.find((n) => n.path === r.path);
                return (
                  <tr key={r.path} data-testid={`row-${r.path}`}>
                    <td data-label='API'>
                      <code>{r.path}</code>
                    </td>
                    <td data-label='fn.toString()' className={naive?.looksNative ? 'ok' : 'err'}>{naive?.looksNative ? 'có (trông sạch)' : 'không'}</td>
                    <td data-label='Realm sạch' className={r.ok ? 'ok' : 'err'} data-testid={`verdict-${r.path}`}>
                      {r.ok ? 'sạch' : 'bị bọc'}
                    </td>
                    <td data-label='Chi tiết'>
                      <ul className='nh-checks'>
                        {r.checks.map((c) => (
                          <li key={c.name} className={c.pass ? 'muted' : 'err'}>
                            {c.pass ? '✓' : '✗'} {c.name}
                            {c.detail && !c.pass ? ` (${c.detail})` : ''}
                          </li>
                        ))}
                      </ul>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <h2 className='nh-h2'>Che chuỗi bằng XOR 1</h2>
      <label className='nh-xor'>
        <span>Chuỗi trong bundle</span>
        <input type='text' value={encoded} onChange={(e) => setEncoded(e.target.value)} />
      </label>
      <p data-testid='xor-out'>
        Giải ra: <code>{encoded.split(',').map(xor1).join(', ')}</code>
      </p>
      <div className='toolbar'>
        <button onClick={clear}>Xoá log</button>
      </div>
      <Log lines={lines} />
    </div>
  );
}
