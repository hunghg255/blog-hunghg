import { useEffect, useRef, useState } from 'react';
import {
  fitTabs,
  isMuted,
  maxOpenTabs,
  MAX_TIMEOUT,
  NotificationTimers,
  onIncomingMessage,
  runPolicy,
  setLongTimeout,
  visibleHeads,
  type Dock,
  type PolicyRule,
} from '../lib/chatTabs';
import { Log, Stat, sleep, useLog } from './shared';
import './ChatTabPolicyDemo.css';

const FRIENDS = ['An', 'Bình', 'Chi', 'Dũng', 'Giang', 'Hà', 'Khoa', 'Lan', 'Minh'];
type Section = 'dock' | 'policy' | 'mute';

export default function ChatTabPolicyDemo() {
  const [section, setSection] = useState<Section>('dock');
  return (
    <div className='page ct-demo'>
      <h1>Tab chat: bao nhiêu tab, mở tab nào, khi nào im lặng</h1>
      <div className='ct-switch' role='tablist'>
        {(
          [
            ['dock', 'Tab và chat head'],
            ['policy', 'Chuỗi luật'],
            ['mute', 'Hẹn giờ bỏ mute'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            role='tab'
            aria-selected={section === id}
            className={section === id ? 'primary' : ''}
            onClick={() => setSection(id)}
            data-testid={`sec-${id}`}
          >
            {label}
          </button>
        ))}
      </div>
      {section === 'dock' && <DockPanel />}
      {section === 'policy' && <PolicyPanel />}
      {section === 'mute' && <MutePanel />}
    </div>
  );
}

// ---------------------------------------------------------------- dock

function DockPanel() {
  const { lines, add } = useLog();
  const [width, setWidth] = useState(1920);
  const [legacy, setLegacy] = useState(false);
  const [dock, setDock] = useState<Dock>({ tabs: [], heads: [] });
  const [notified, setNotified] = useState<string[]>([]);
  const sentAt = useRef(new Map<string, number>());
  const timers = useRef<NotificationTimers | null>(null);
  const legacyTimers = useRef<[string, ReturnType<typeof setTimeout>][]>([]);

  useEffect(() => {
    const t = new NotificationTimers((id) => {
      setNotified((n) => n.filter((x) => x !== id));
      const since = (performance.now() - (sentAt.current.get(id) ?? 0)) / 1000;
      add(`Thông báo ${id} tắt, ${since.toFixed(1)}s sau tin cuối`, 'ok');
    });
    timers.current = t;
    const legacyRef = legacyTimers.current;
    return () => {
      t.dispose();
      legacyRef.forEach(([, id]) => clearTimeout(id));
    };
  }, [add]);

  const max = maxOpenTabs(width);
  const maxCeil = maxOpenTabs(width, { round: 'ceil' });
  const half = Math.floor(width / 2);

  const notify = (id: string) => {
    sentAt.current.set(id, performance.now());
    setNotified((n) => (n.includes(id) ? n : [...n, id]));
    if (!legacy) return timers.current!.notify(id);
    // bản gốc: đưa entry xuống cuối, đặt timer mới, KHÔNG huỷ timer cũ
    const list = legacyTimers.current;
    const i = list.findIndex(([t]) => t === id);
    const timer = setTimeout(() => {
      legacyTimers.current = legacyTimers.current.filter(([t]) => t !== id);
      setNotified((n) => n.filter((x) => x !== id));
      const since = (performance.now() - (sentAt.current.get(id) ?? 0)) / 1000;
      add(`Thông báo ${id} tắt, ${since.toFixed(1)}s sau tin cuối`, since < 2.9 ? 'err' : 'ok');
    }, 3000);
    legacyTimers.current = i === -1 ? [[id, timer], ...list] : [...list.slice(i + 1), ...list.slice(0, i), [id, timer]];
  };

  const incoming = (id: string) => {
    const r = onIncomingMessage(dock, id, max, { legacyFallback: legacy });
    setDock(r.dock);
    notify(id);
    if (r.outcome.kind === 'opened') add(`Tin từ ${id}: mở tab mới (không lấy focus)`);
    else if (r.outcome.kind === 'replaced') {
      const lost = dock.tabs.find((t) => t.threadId === (r.outcome as { closed: string }).closed);
      add(
        `Tin từ ${id}: thay tab ${lost?.threadId}${lost?.draft ? ' — tab này đang có chữ soạn dở!' : ''}`,
        lost?.draft ? 'err' : undefined,
      );
    } else add(`Tin từ ${id}: chỉ cập nhật chat head`, 'muted');
  };

  const twice = async () => {
    incoming('An');
    await sleep(2000);
    notify('An');
    add('An gửi thêm một tin sau 2 giây');
  };

  const resize = (w: number) => {
    setWidth(w);
    setDock((d) => ({ ...d, tabs: fitTabs(d.tabs, maxOpenTabs(w)) }));
  };

  const patchTab = (id: string, patch: (t: Dock['tabs'][number]) => Dock['tabs'][number]) =>
    setDock((d) => ({ ...d, tabs: d.tabs.map((t) => (t.threadId === id ? patch(t) : t)) }));
  const focus = (id: string) =>
    setDock((d) => ({ ...d, tabs: d.tabs.map((t) => ({ ...t, focused: t.threadId === id })) }));
  const close = (id: string) =>
    setDock((d) => ({ tabs: d.tabs.filter((t) => t.threadId !== id), heads: d.heads.filter((h) => h !== id) }));
  const openFromHead = (id: string) =>
    setDock((d) => ({
      ...d,
      tabs: [{ threadId: id, focused: true, draft: false }, ...d.tabs.map((t) => ({ ...t, focused: false }))].slice(
        0,
        max,
      ),
    }));

  const heads = visibleHeads(dock.heads, dock.tabs);

  return (
    <>
      <p className='hint'>
        Kéo độ rộng cửa sổ, bấm "tin từ …". Tab mới mở ở trạng thái không focus. Hết chỗ thì chỉ thay
        tab <b>không focus và không có chữ soạn dở</b>; không có tab như vậy thì chỉ đẩy chat head.
        Thử: focus tab A, đánh dấu B và C "soạn dở", rồi nhận tin mới ở chế độ bản gốc.
      </p>
      <div className='toolbar ct-wrap'>
        <label>
          Cửa sổ <b>{width}px</b>
          <input
            type='range'
            min={800}
            max={2560}
            step={10}
            value={width}
            onChange={(e) => resize(+e.target.value)}
            data-testid='width'
          />
        </label>
        <label className='ct-check'>
          <input type='checkbox' checked={legacy} onChange={(e) => setLegacy(e.target.checked)} data-testid='legacy' />
          Mô phỏng bản gốc (thay tab có draft, timer không huỷ)
        </label>
      </div>
      <div className='stats'>
        <Stat label='tab tối đa (làm tròn xuống)' value={<output data-testid='max'>{max}</output>} />
        <Stat label={`bản gốc làm tròn lên: ${maxCeil * 338}px`} value={<output data-testid='max-ceil'>{maxCeil}</output>} />
        <Stat label='nửa màn hình trừ cột head' value={`${half - 90}px`} />
      </div>
      <div className='toolbar ct-wrap'>
        {FRIENDS.map((f) => (
          <button key={f} onClick={() => incoming(f)} data-testid={`msg-${f}`}>
            Tin từ {f}
          </button>
        ))}
        <button className='primary' onClick={twice} data-testid='twice'>
          An gửi 2 tin cách 2 giây
        </button>
      </div>

      <div className='ct-screen'>
        <div className='ct-half' title='nửa màn hình' />
        <div className='ct-dock'>
          {dock.tabs.map((t) => (
            <div
              key={t.threadId}
              className={`ct-tab ${t.focused ? 'focused' : ''} ${notified.includes(t.threadId) ? 'ping' : ''}`}
              style={{ width: `${(338 / width) * 100}%` }}
              data-testid={`tab-${t.threadId}`}
            >
              <div className='ct-tab-head'>
                <b>{t.threadId}</b>
                <button aria-label={`Đóng ${t.threadId}`} onClick={() => close(t.threadId)}>
                  ×
                </button>
              </div>
              <button onClick={() => focus(t.threadId)}>{t.focused ? 'đang focus' : 'focus'}</button>
              <label className='ct-check'>
                <input
                  type='checkbox'
                  checked={t.draft}
                  onChange={(e) => patchTab(t.threadId, (x) => ({ ...x, draft: e.target.checked }))}
                  data-testid={`draft-${t.threadId}`}
                />
                soạn dở
              </label>
            </div>
          ))}
        </div>
        <div className='ct-heads'>
          {heads.shown.map((h) => (
            <button
              key={h}
              className={`ct-head ${notified.includes(h) ? 'ping' : ''}`}
              onClick={() => openFromHead(h)}
              title={h}
            >
              {h[0]}
            </button>
          ))}
          {heads.overflow.length > 0 && <span className='ct-head more'>+{heads.overflow.length}</span>}
        </div>
      </div>
      <Log lines={lines} />
    </>
  );
}

// ---------------------------------------------------------------- policy

interface Ctx {
  killswitch: boolean;
  outgoing: boolean;
  tabsOff: boolean;
  muted: boolean;
  mentioned: boolean;
  mentionsMuted: boolean;
  system: boolean;
  notInbox: boolean;
  blockedInGroup: boolean;
  noContactId: boolean;
}

const LABELS: Record<keyof Ctx, string> = {
  killswitch: 'Killswitch tắt tính năng',
  outgoing: 'Tin do chính mình gửi',
  tabsOff: 'Người dùng tắt chat tab (đọc setting, 400ms)',
  muted: 'Thread đang mute',
  mentioned: '… nhưng tin @nhắc tới mình',
  mentionsMuted: '… và đã mute cả lượt nhắc',
  system: 'Không phải tin người dùng gửi',
  notInbox: 'Thread không nằm trong Inbox',
  blockedInGroup: 'Nhóm có người mình đã chặn (300ms)',
  noContactId: 'Liên hệ chưa có id người dùng',
};

const RULES: PolicyRule<Ctx>[] = [
  { name: 'killswitch', blocks: (c) => c.killswitch },
  { name: 'outgoing', blocks: (c) => c.outgoing },
  { name: 'tabsOff', blocks: async (c) => (await sleep(400), c.tabsOff) },
  { name: 'muted', blocks: (c) => c.muted && (c.mentionsMuted || !c.mentioned) },
  { name: 'system', blocks: (c) => c.system },
  { name: 'notInbox', blocks: (c) => c.notInbox },
  { name: 'blockedInGroup', blocks: async (c) => (await sleep(300), c.blockedInGroup) },
  { name: 'noContactId', blocks: (c) => c.noContactId },
];

function PolicyPanel() {
  const [ctx, setCtx] = useState<Ctx>({
    killswitch: false,
    outgoing: false,
    tabsOff: false,
    muted: true,
    mentioned: true,
    mentionsMuted: false,
    system: false,
    notInbox: false,
    blockedInGroup: false,
    noContactId: false,
  });
  const [trace, setTrace] = useState<Record<string, 'pass' | 'block' | 'run'>>({});
  const [result, setResult] = useState<string>('');
  const run = async () => {
    setResult('');
    const seen: Record<string, 'pass' | 'block' | 'run'> = {};
    const t0 = performance.now();
    // bọc từng luật để vẽ trạng thái, logic chặn vẫn là runPolicy
    const traced = RULES.map((r) => ({
      name: r.name,
      blocks: async (c: Ctx) => {
        seen[r.name] = 'run';
        setTrace({ ...seen });
        const b = await r.blocks(c);
        seen[r.name] = b ? 'block' : 'pass';
        setTrace({ ...seen });
        return b;
      },
    }));
    const r = await runPolicy(traced, ctx);
    const ms = Math.round(performance.now() - t0);
    setResult(r.allowed ? `Cho phép bật tab (${ms}ms)` : `Chặn bởi luật "${r.rule}" (${ms}ms)`);
  };
  return (
    <>
      <p className='hint'>
        Tám luật chạy lần lượt, luật đầu tiên chặn thì dừng. Hai luật bất đồng bộ (đọc setting, danh
        sách chặn) nằm chung chuỗi với luật đồng bộ. Bản gốc viết theo kiểu continuation: bị chặn thì
        callback không bao giờ được gọi; bản viết lại luôn trả về kết quả và tên luật.
      </p>
      <div className='ct-policy'>
        <div className='card ct-flags'>
          {(Object.keys(LABELS) as (keyof Ctx)[]).map((k) => (
            <label key={k} className='ct-check'>
              <input
                type='checkbox'
                checked={ctx[k]}
                onChange={(e) => setCtx({ ...ctx, [k]: e.target.checked })}
                data-testid={`flag-${k}`}
              />
              {LABELS[k]}
            </label>
          ))}
          <button className='primary' onClick={run} data-testid='run'>
            Tin mới đến
          </button>
          <output className='ct-result' data-testid='result'>
            {result}
          </output>
        </div>
        <ol className='ct-rules'>
          {RULES.map((r) => (
            <li key={r.name} className={trace[r.name] ?? 'idle'} data-testid={`rule-${r.name}`}>
              <code>{r.name}</code>
              <span>
                {trace[r.name] === 'pass'
                  ? 'qua'
                  : trace[r.name] === 'block'
                    ? 'CHẶN'
                    : trace[r.name] === 'run'
                      ? 'đang chạy…'
                      : 'không chạy'}
              </span>
            </li>
          ))}
        </ol>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- mute

const DURATIONS: [string, number][] = [
  ['1 giờ', 3600_000],
  ['24 giờ', 86_400_000],
  ['24 ngày', 24 * 86_400_000],
  ['30 ngày', 30 * 86_400_000],
];

function MutePanel() {
  const { lines, add } = useLog();
  const [dur, setDur] = useState(3);
  const [raw, setRaw] = useState<number | null>(null);
  const [safe, setSafe] = useState<number | null>(null);
  const [, tick] = useState(0);
  const cleanups = useRef<(() => void)[]>([]);
  useEffect(() => {
    const id = setInterval(() => tick((x) => x + 1), 500);
    const list = cleanups.current;
    return () => {
      clearInterval(id);
      list.forEach((f) => f());
    };
  }, []);

  const mute = (kind: 'raw' | 'safe') => {
    const ms = DURATIONS[dur][1];
    const until = Date.now() + ms;
    const t0 = performance.now();
    const unmute = () => {
      const after = performance.now() - t0;
      (kind === 'raw' ? setRaw : setSafe)(null);
      add(
        `${kind === 'raw' ? 'setTimeout thô' : 'setLongTimeout'}: tự bỏ mute sau ${after.toFixed(0)}ms (hẹn ${DURATIONS[dur][0]})`,
        after < ms ? 'err' : 'ok',
      );
    };
    if (kind === 'raw') {
      const id = setTimeout(unmute, ms);
      cleanups.current.push(() => clearTimeout(id));
      setRaw(until);
    } else {
      cleanups.current.push(setLongTimeout(unmute, ms));
      setSafe(until);
      add(`setLongTimeout: chia thành ${Math.ceil(ms / MAX_TIMEOUT)} chặng ≤ ${MAX_TIMEOUT}ms`, 'muted');
    }
  };

  const show = (until: number | null) =>
    until !== null && isMuted(until) ? `đang mute tới ${new Date(until).toLocaleDateString('vi-VN')}` : 'không mute';

  return (
    <>
      <p className='hint'>
        Hook gốc đặt <code>setTimeout(unmute, muteUntil - Date.now())</code>. Delay của setTimeout là
        số nguyên 32 bit có dấu: quá {MAX_TIMEOUT.toLocaleString('vi-VN')}ms (khoảng 24,8 ngày) thì
        trình duyệt coi như 0 và chạy ngay. Chọn "30 ngày" rồi bấm hai nút để xem trên chính trình
        duyệt này.
      </p>
      <div className='toolbar ct-wrap'>
        {DURATIONS.map(([label], i) => (
          <label key={label} className='ct-check'>
            <input type='radio' name='dur' checked={dur === i} onChange={() => setDur(i)} data-testid={`dur-${i}`} />
            {label}
          </label>
        ))}
      </div>
      <div className='toolbar'>
        <button onClick={() => mute('raw')} data-testid='mute-raw'>
          Mute bằng setTimeout thô
        </button>
        <button className='primary' onClick={() => mute('safe')} data-testid='mute-safe'>
          Mute bằng setLongTimeout
        </button>
      </div>
      <div className='stats'>
        <Stat label='setTimeout thô' value={<output data-testid='raw-state'>{show(raw)}</output>} />
        <Stat label='setLongTimeout' value={<output data-testid='safe-state'>{show(safe)}</output>} />
      </div>
      <Log lines={lines} />
    </>
  );
}
