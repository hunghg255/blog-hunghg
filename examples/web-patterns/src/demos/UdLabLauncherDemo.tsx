import { useEffect, useRef, useState } from 'react';
import { createHeartbeat, LabConflictError, launchInPlaceholder, type LaunchApi } from '../lib/udLabLauncher';
import { Log, Stat, sleep, useLog } from './shared';
import './UdLabLauncherDemo.css';

// Trang "workspace" giả: một blob HTML, để không phải gọi dịch vụ ngoài
function workspaceUrl() {
  const html = `<!doctype html><meta charset="utf-8"><title>Lab workspace</title>
<body style="font:16px system-ui;padding:24px;background:#111;color:#eee">
<h1>🧪 Lab workspace (giả lập)</h1><p>opener = <b id="o"></b></p>
<script>document.getElementById('o').textContent = String(window.opener)</script></body>`;
  return URL.createObjectURL(new Blob([html], { type: 'text/html' }));
}

function userActivationActive() {
  const ua = (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation;
  return ua ? ua.isActive : null;
}

export default function UdLabLauncherDemo() {
  const { lines, add, clear } = useLog();
  const [apiMs, setApiMs] = useState(800);
  const [conflict, setConflict] = useState(false);
  const [running, setRunning] = useState<string[] | null>(null);
  const [lastLink, setLastLink] = useState<string | null>(null);

  const api: LaunchApi = {
    async createInstance() {
      await sleep(apiMs);
      if (conflict) throw new LabConflictError(['Docker cơ bản (đang chạy 12 phút)', 'AWS S3 (đang chạy 3 phút)']);
      return { workspaceUrl: workspaceUrl() };
    },
  };

  // Cách 1: gọi API xong mới window.open — lúc đó kích hoạt từ cú click có thể đã hết hạn
  async function openAfterAwait() {
    add(`[sau await] gọi API (${apiMs}ms)…`, 'muted');
    try {
      const { workspaceUrl: url } = await api.createInstance();
      const active = userActivationActive();
      const tab = window.open(url, '_blank');
      add(
        `[sau await] userActivation.isActive=${active} → window.open ${tab ? 'mở được' : 'BỊ CHẶN (trả về null)'}`,
        tab ? 'ok' : 'err',
      );
      if (!tab) setLastLink(url);
    } catch (e) {
      add(`[sau await] ${(e as Error).message}`, 'err');
    }
  }

  // Cách 2 (Udemy): mở tab chờ ngay trong click, gọi API, rồi mới điền URL
  async function openPlaceholderFirst() {
    add(`[mở trước] userActivation.isActive=${userActivationActive()} → mở tab chờ, gọi API (${apiMs}ms)…`, 'muted');
    const result = await launchInPlaceholder(api);
    if (result.kind === 'opened') add('[mở trước] đã điền URL workspace vào tab chờ (opener = null)', 'ok');
    if (result.kind === 'blocked') {
      add('[mở trước] trình duyệt vẫn chặn → hiện link cho người dùng tự bấm', 'warn');
      setLastLink(result.url);
    }
    if (result.kind === 'conflict') {
      add('[mở trước] 409: đang có lab khác chạy → đóng tab chờ, hỏi người dùng', 'warn');
      setRunning(result.runningLabs);
    }
    if (result.kind === 'error') add(`[mở trước] lỗi: ${result.message}`, 'err');
  }

  // ---- Nhịp tim: so bản giống Udemy (setInterval + async) với createHeartbeat ----
  const LOG_EVERY = 3000; // thu nhỏ từ 15s để demo nhanh
  const [syncMs, setSyncMs] = useState(900);
  const [hb, setHb] = useState({ seconds: 0, udemyPosts: 0, udemyLogged: 0, fixedPosts: 0, fixedLogged: 0 });
  const [hbRunning, setHbRunning] = useState(false);
  const stopRef = useRef<() => void>(() => {});

  useEffect(() => () => stopRef.current(), []);

  function startHeartbeats() {
    stopRef.current();
    setHb({ seconds: 0, udemyPosts: 0, udemyLogged: 0, fixedPosts: 0, fixedLogged: 0 });
    const started = Date.now();
    const sync = () => sleep(syncMs); // "đồng bộ trạng thái lab" khi lab đang chuyển trạng thái

    // (a) mô phỏng heartbeat.js + onTick của Udemy
    const u = { last: Date.now(), prevElapsed: 0, refreshing: false };
    const udemyTick = async () => {
      const elapsed = Date.now() - u.last;
      if (elapsed >= u.prevElapsed) {
        if (elapsed >= LOG_EVERY) {
          setHb((s) => ({ ...s, udemyPosts: s.udemyPosts + 1, udemyLogged: s.udemyLogged + elapsed }));
          if (!u.refreshing) {
            u.refreshing = true;
            await sync();
            u.refreshing = false;
          }
        }
        u.prevElapsed = elapsed;
        if (elapsed >= LOG_EVERY) {
          u.prevElapsed = 0;
          u.last = Date.now();
        }
      }
    };
    const udemyId = setInterval(udemyTick, 250);

    // (b) createHeartbeat: setTimeout lồng nhau, không chồng lượt
    const heartbeat = createHeartbeat({
      tickMs: 250,
      logEveryMs: LOG_EVERY,
      onLog: async (_start, elapsed) => {
        setHb((s) => ({ ...s, fixedPosts: s.fixedPosts + 1, fixedLogged: s.fixedLogged + elapsed }));
        await sync();
      },
    });
    heartbeat.start();

    const clock = setInterval(() => setHb((s) => ({ ...s, seconds: (Date.now() - started) / 1000 })), 250);
    setHbRunning(true);
    stopRef.current = () => {
      clearInterval(udemyId);
      clearInterval(clock);
      heartbeat.stop();
      setHbRunning(false);
    };
  }

  return (
    <div className='page udl'>
      <h1>Mở lab không bị chặn popup, nhịp tim không chồng lượt</h1>

      <h2>1. Mở tab workspace</h2>
      <p className='hint'>
        <code>window.open</code> chỉ được phép khi trang còn &quot;kích hoạt tạm thời&quot; từ cú click (Chrome giữ khoảng
        5 giây). API tạo lab chậm hơn mức đó thì cách &quot;gọi API rồi mới mở&quot; bị chặn. Trình duyệt đã tắt chặn popup
        (vd. chạy headless) thì vẫn mở được: xem giá trị <code>userActivation.isActive</code> trong log.
      </p>
      <div className='toolbar'>
        <label>
          API tạo lab mất{' '}
          <select value={apiMs} onChange={(e) => setApiMs(Number(e.target.value))}>
            <option value={800}>0,8 giây</option>
            <option value={6500}>6,5 giây</option>
          </select>
        </label>
        <label>
          <input type='checkbox' checked={conflict} onChange={(e) => setConflict(e.target.checked)} /> Đang có lab khác
          chạy (409)
        </label>
      </div>
      <div className='toolbar'>
        <button onClick={openAfterAwait} data-testid='open-after'>
          Gọi API rồi mới mở
        </button>
        <button className='primary' onClick={openPlaceholderFirst} data-testid='open-first'>
          Mở tab chờ trước (Udemy)
        </button>
        <button onClick={clear}>Xoá log</button>
      </div>
      {lastLink && (
        <p className='hint'>
          Trình duyệt đã chặn. Đường dự phòng: <a href={lastLink} target='_blank' rel='noopener noreferrer'>mở workspace</a>.
        </p>
      )}
      {running && (
        <div className='card udl-modal' role='dialog' aria-label='Lab đang chạy'>
          <b>Bạn đang chạy {running.length} lab khác.</b> Dừng lab cũ để mở lab mới?
          <ul>
            {running.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
          <button onClick={() => setRunning(null)}>Đóng</button>
        </div>
      )}
      <Log lines={lines} />

      <h2>2. Nhịp tim ghi tiến độ</h2>
      <p className='hint'>
        Tick 250ms, ghi tiến độ mỗi {LOG_EVERY / 1000}s (Udemy: 15s). Khi lab đang chuyển trạng thái, mỗi lần ghi còn phải
        đồng bộ trạng thái mất {syncMs}ms. Kiểu Udemy dùng <code>setInterval(async tick)</code>: tick sau chạy khi tick
        trước còn đang <code>await</code>.
      </p>
      <div className='toolbar'>
        <label>
          Đồng bộ trạng thái mất{' '}
          <select value={syncMs} onChange={(e) => setSyncMs(Number(e.target.value))}>
            <option value={0}>0ms</option>
            <option value={900}>900ms</option>
          </select>
        </label>
        {!hbRunning ? (
          <button className='primary' onClick={startHeartbeats} data-testid='hb-start'>
            ▶ Chạy 2 nhịp tim
          </button>
        ) : (
          <button onClick={() => stopRef.current()} data-testid='hb-stop'>
            ■ Dừng
          </button>
        )}
      </div>
      <div className='stats'>
        <Stat label='giây đã chạy' value={<output data-testid='hb-seconds'>{hb.seconds.toFixed(1)}</output>} />
        <Stat
          label='kiểu Udemy: lần ghi / giây đã ghi'
          value={
            <output data-testid='hb-udemy'>
              {hb.udemyPosts} / {(hb.udemyLogged / 1000).toFixed(1)}
            </output>
          }
        />
        <Stat
          label='createHeartbeat: lần ghi / giây đã ghi'
          value={
            <output data-testid='hb-fixed'>
              {hb.fixedPosts} / {(hb.fixedLogged / 1000).toFixed(1)}
            </output>
          }
        />
      </div>
    </div>
  );
}
