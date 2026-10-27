import { useMemo, useReducer, useRef, useState } from 'react';
import { createLimitedStorage, createQuotaStorage, isQuotaError, type StorageLike } from '../lib/quotaStorage';
import { Log, Stat, useLog } from './shared';
import './QuotaStorageDemo.css';

const CAPACITY = 2400;
type Mode = 'fixed' | 'fb';

/**
 * Mô phỏng hành vi CacheStorage gốc (không phải mã của Facebook): khi đầy, quét MỌI key
 * trong storage; giá trị không parse được JSON thì xoá luôn; entry có __t thì xếp theo tuổi
 * và xoá nửa cũ. remove() của callback dùng slice nên không gỡ được.
 */
function createFbStyleStorage(backend: StorageLike, prefix: string, now: () => number) {
  const callbacks: Array<(key: string) => void> = [];
  const evict = () => {
    const keys: string[] = [];
    for (let i = 0; i < backend.length; i++) keys.push(backend.key(i)!);
    const aged: Array<[string, number]> = [];
    keys.forEach((k) => {
      const raw = backend.getItem(k)!;
      if (raw.startsWith('_@_')) return;
      try {
        const v = JSON.parse(raw);
        if (v && v.__t !== undefined && v.__v !== undefined) aged.push([k, v.__t]);
      } catch {
        backend.removeItem(k); // giá trị không phải JSON của code khác cũng bị xoá
      }
    });
    aged.sort((a, b) => a[1] - b[1]);
    for (let i = 0; i < Math.ceil(aged.length / 2); i++) backend.removeItem(aged[i][0]);
  };
  return {
    set(key: string, value: unknown) {
      const payload = JSON.stringify({ __t: now(), __v: value });
      let retry = true;
      while (retry) {
        try {
          backend.setItem(prefix + key, payload);
          retry = false;
          callbacks.forEach((cb) => cb(key));
          return true;
        } catch (error) {
          if (!isQuotaError(error)) throw error;
          const before = backend.length;
          evict();
          retry = backend.length < before;
        }
      }
      return false;
    },
    onChange(cb: (key: string) => void) {
      callbacks.push(cb);
      return {
        remove() {
          callbacks.slice(callbacks.indexOf(cb), 1); // lỗi gốc: slice không sửa mảng
        },
      };
    },
  };
}

const FOREIGN: Array<[string, string]> = [
  ['theme', 'dark'], // chuỗi thường, không phải JSON
  ['i18n-locale', 'vi-VN'],
  ['draft-post', JSON.stringify({ text: 'Bản nháp chưa đăng của người dùng' })],
];

function makeWorld(mode: Mode) {
  const backend = createLimitedStorage(CAPACITY);
  FOREIGN.forEach(([k, v]) => backend.setItem(k, v));
  let clock = 1_000;
  const now = () => (clock += 1_000);
  const store = mode === 'fixed' ? createQuotaStorage({ backend, prefix: '_cs_', now }) : createFbStyleStorage(backend, '_cs_', now);
  return { backend, store };
}

let entryId = 0;

export default function QuotaStorageDemo() {
  const [mode, setMode] = useState<Mode>('fixed');
  const world = useMemo(() => makeWorld(mode), [mode]);
  const [, force] = useReducer((x: number) => x + 1, 0);
  const { lines, add, clear } = useLog(40);
  const callbackHits = useRef(0);
  const [hits, setHits] = useState(0);

  const write = (n: number) => {
    for (let i = 0; i < n; i++) {
      const id = `feed-${++entryId}`;
      const before = new Set(world.backend.dump().map(([k]) => k));
      const ok = world.store.set(id, { posts: 'x'.repeat(120), id });
      const after = new Set(world.backend.dump().map(([k]) => k));
      const removed = [...before].filter((k) => !after.has(k));
      if (removed.length) {
        const foreign = removed.filter((k) => !k.startsWith('_cs_'));
        add(
          `Đầy quota khi ghi ${id}: xoá ${removed.length} key${foreign.length ? ` — gồm key của code khác: ${foreign.join(', ')}` : ''}`,
          foreign.length ? 'err' : 'warn',
        );
      }
      if (!ok) add(`Không ghi được ${id}`, 'err');
    }
    force();
  };

  const tryCallback = () => {
    callbackHits.current = 0;
    const sub = world.store.onChange(() => {
      callbackHits.current++;
    });
    sub.remove();
    world.store.set(`probe-${++entryId}`, 1);
    setHits(callbackHits.current);
    add(
      callbackHits.current
        ? `Đã gọi remove() nhưng callback vẫn chạy ${callbackHits.current} lần (slice thay vì splice)`
        : 'Gọi remove() xong, callback không chạy nữa',
      callbackHits.current ? 'err' : 'ok',
    );
    force();
  };

  const entries = world.backend.dump();
  const foreignAlive = FOREIGN.filter(([k]) => world.backend.getItem(k) !== null).length;

  return (
    <div className='page qs-demo'>
      <h1>localStorage tự dọn khi đầy quota</h1>
      <p className='hint'>
        Storage giả chỉ chứa {CAPACITY} ký tự. Ghi liên tục để đầy: kho sẽ xoá nửa số entry cũ nhất rồi ghi tiếp. Chế độ
        "mô phỏng bản gốc" quét mọi key và xoá cả giá trị không phải JSON của code khác (ví dụ <code>theme</code>).
      </p>
      <div className='toolbar' role='group' aria-label='Chế độ'>
        <label className='switch'>
          <input type='radio' checked={mode === 'fixed'} onChange={() => setMode('fixed')} /> Bản viết lại
        </label>
        <label className='switch'>
          <input type='radio' checked={mode === 'fb'} onChange={() => setMode('fb')} /> Mô phỏng bản gốc
        </label>
      </div>
      <div className='stats'>
        <Stat label={`ký tự đã dùng / ${CAPACITY}`} value={<output data-testid='used'>{world.backend.used()}</output>} />
        <Stat label='số key' value={<output data-testid='count'>{entries.length}</output>} />
        <Stat label='key của code khác còn lại' value={<output data-testid='foreign'>{`${foreignAlive}/${FOREIGN.length}`}</output>} />
        <Stat label='callback chạy sau remove()' value={<output data-testid='hits'>{hits}</output>} />
      </div>
      <div className='toolbar'>
        <button className='primary' onClick={() => write(1)}>
          Ghi 1 entry
        </button>
        <button onClick={() => write(10)}>Ghi 10 entry</button>
        <button onClick={tryCallback}>Đăng ký rồi gỡ callback</button>
      </div>
      <div className='qs-bar' aria-hidden='true'>
        <div style={{ width: `${(world.backend.used() / CAPACITY) * 100}%` }} />
      </div>
      <ul className='qs-keys'>
        {entries.map(([k, v]) => {
          let t = '';
          try {
            const p = JSON.parse(v);
            if (p && typeof p.__t === 'number') t = `__t=${p.__t}`;
          } catch {
            t = 'không phải JSON';
          }
          return (
            <li key={k} className={k.startsWith('_cs_') ? '' : 'qs-foreign'}>
              <code>{k}</code> <small className='muted'>{t}</small>
            </li>
          );
        })}
      </ul>
      <div className='toolbar'>
        <button onClick={clear}>Xoá log</button>
      </div>
      <Log lines={lines} />
    </div>
  );
}
