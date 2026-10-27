import { useEffect, useRef, useState } from 'react';
import { createGovernor, waitForQuietWindow, type GovernedTask } from '../lib/ttiGovernor';
import { Log, Stat, sleep, useLog } from './shared';
import './TtiGovernorDemo.css';

// Việc phụ lúc khởi động của một app email giả: tải module (mạng) rồi khởi tạo (CPU)
const JOBS = [
  { name: 'Thông báo', net: 180, cpu: 60, idle: false },
  { name: 'Danh bạ', net: 240, cpu: 70, idle: false },
  { name: 'Phím tắt', net: 120, cpu: 30, idle: false },
  { name: 'Lọc thư rác', net: 200, cpu: 80, idle: false },
  { name: 'Đồng bộ lịch', net: 260, cpu: 60, idle: false },
  { name: 'Huy hiệu chưa đọc', net: 140, cpu: 40, idle: false },
  { name: 'Khảo sát', net: 300, cpu: 90, idle: true },
  { name: 'Gợi ý cá nhân', net: 220, cpu: 70, idle: true },
  { name: 'Thông tin tài khoản', net: 160, cpu: 50, idle: true },
  { name: 'Tab phụ đọc thư', net: 200, cpu: 60, idle: true },
];

const SCALE_MS = 5000; // độ rộng timeline

/** Chiếm main thread `ms` mili giây, giả lập code khởi tạo nặng. */
function busy(ms: number) {
  const end = performance.now() + ms;
  while (performance.now() < end) {
    // bận
  }
}

interface Bar {
  name: string;
  idle: boolean;
  monkey: boolean;
  start: number;
  cpuStart?: number;
  end?: number;
}

type Mode = 'naive' | 'governed';

export default function TtiGovernorDemo() {
  const { lines, add, clear } = useLog(30);
  const [mode, setMode] = useState<Mode>('governed');
  const [concurrency, setConcurrency] = useState(3);
  const [monkey, setMonkey] = useState(false);
  const [bars, setBars] = useState<Bar[]>([]);
  const [running, setRunning] = useState(false);
  const [maxGap, setMaxGap] = useState(0);
  const [clickDelay, setClickDelay] = useState<number | null>(null);
  const [idleAt, setIdleAt] = useState<number | null>(null);
  const t0 = useRef(0);
  const rafStop = useRef<() => void>(() => {});

  useEffect(() => () => rafStop.current(), []);

  // Đo khung hình bị đứng lâu nhất bằng requestAnimationFrame
  const watchFrames = (durationMs: number) => {
    rafStop.current();
    let last = performance.now();
    let worst = 0;
    let id = 0;
    const loop = (now: number) => {
      worst = Math.max(worst, now - last);
      last = now;
      setMaxGap(worst);
      if (now - t0.current < durationMs) id = requestAnimationFrame(loop);
    };
    id = requestAnimationFrame(loop);
    rafStop.current = () => cancelAnimationFrame(id);
  };

  const boot = async () => {
    clear();
    setRunning(true);
    setMaxGap(0);
    setClickDelay(null);
    setIdleAt(null);
    t0.current = performance.now();
    const at = () => Math.round(performance.now() - t0.current);
    const records: Bar[] = JOBS.map((j) => ({ name: j.name, idle: j.idle, monkey: false, start: -1 }));
    const publish = () => setBars(records.map((r) => ({ ...r })));
    publish();
    watchFrames(SCALE_MS);
    add('▶ khởi động: phần giao diện chính đã vẽ xong', 'muted');
    await sleep(50); // cho trình duyệt vẽ trạng thái ban đầu

    if (mode === 'naive') {
      // Cách ngây thơ: mọi module nằm sẵn trong bundle chính, khởi tạo ngay lúc boot
      setTimeout(() => {
        const start = at();
        records.forEach((r, i) => {
          r.start = start;
          r.cpuStart = at();
          busy(JOBS[i].cpu);
          r.end = at();
        });
        publish();
        add(`⛔ khởi tạo cả ${JOBS.length} việc liền một mạch: main thread bận ${at() - start}ms`, 'err');
        setRunning(false);
      }, 0);
      return;
    }

    const governor = createGovernor({
      profile: { concurrency, delay: 1, pulse: 1 },
      // demo rút ngắn: yên lặng 600ms là coi như tương tác được, tối đa chờ 3 giây
      whenInteractive: () =>
        waitForQuietWindow({ quietMs: 600 }).then(() => {
          setIdleAt(at());
          add(`🟢 trang yên 600ms không có long task: bắt đầu việc idle (t=${at()}ms)`, 'ok');
        }),
      interactiveTimeout: 3000,
      monkey: monkey ? { delayMs: 2500 } : undefined,
      onTaskStart: ({ task, index, delayedByMonkey }) => {
        if (!delayedByMonkey) return;
        const i = tasks.findIndex((t) => typeof t !== 'function' && t.task === task);
        records[i].monkey = true;
        publish();
        add(`🐒 monkey làm trễ "${JOBS[i].name}" (việc thứ ${index + 1}) thêm 2,5 giây`, 'warn');
      },
      onReport: (r) =>
        add(`📊 báo cáo: ${r.tasks} việc, concurrency ${r.profile.concurrency}, monkey ${r.monkey < 0 ? "tắt" : `#${r.monkey + 1}`}, việc cuối bắt đầu ở ${Math.round(r.elapsedMs)}ms`, 'muted'),
    });

    let finished = 0;
    const tasks: GovernedTask[] = JOBS.map((job, i) => ({
      idle: job.idle,
      task: async () => {
        const r = records[i];
        r.start = at();
        publish();
        await sleep(job.net); // tải chunk
        r.cpuStart = at();
        busy(job.cpu); // khởi tạo module
        r.end = at();
        publish();
        if (++finished === JOBS.length) {
          add(`✅ xong cả ${JOBS.length} việc ở t=${at()}ms`, 'ok');
          setRunning(false);
        }
      },
    }));
    // giống Outlook: xếp hàng xong mới bật báo cáo (và chọn việc cho monkey)
    void governor.govern(...tasks).then(() => governor.enableReport());
  };

  const probe = (e: React.MouseEvent) => {
    // event.timeStamp: lúc trình duyệt nhận click; hiệu = thời gian click phải chờ main thread
    const delay = Math.round(performance.now() - e.timeStamp);
    setClickDelay(delay);
    add(`👆 click được xử lý sau ${delay}ms`, delay > 100 ? 'warn' : 'ok');
  };

  return (
    <div className='page tti'>
      <h1>TTI governor</h1>
      <p className='hint'>
        Bấm <b>Khởi động</b> rồi bấm liên tục nút <b>Bấm thử</b> và nhìn quả bóng. Cách ngây thơ khởi tạo cả
        10 việc phụ liền một mạch, trang đứng hình. Governor cho mỗi việc một lượt riêng, việc{' '}
        <span className='tti-chip idle'>idle</span> chờ tới khi trang yên.
      </p>
      <div className='toolbar'>
        <label className='switch'>
          <input type='radio' checked={mode === 'naive'} onChange={() => setMode('naive')} /> Ngây thơ
        </label>
        <label className='switch'>
          <input type='radio' checked={mode === 'governed'} onChange={() => setMode('governed')} /> Governor
        </label>
        <label className='switch'>
          Song song
          <select value={concurrency} onChange={(e) => setConcurrency(Number(e.target.value))} disabled={mode === 'naive'}>
            <option value={1}>1</option>
            <option value={3}>3 (Outlook)</option>
            <option value={6}>6</option>
          </select>
        </label>
        <label className='switch'>
          <input type='checkbox' checked={monkey} disabled={mode === 'naive'} onChange={(e) => setMonkey(e.target.checked)} />{' '}
          Monkey
        </label>
      </div>
      <div className='toolbar'>
        <button className='primary' onClick={boot} disabled={running}>
          ▶ Khởi động
        </button>
        <button onClick={probe}>👆 Bấm thử</button>
        <span className='tti-ball' aria-hidden />
      </div>
      <div className='stats'>
        <Stat label='Khung hình đứng lâu nhất' value={`${Math.round(maxGap)}ms`} />
        <Stat label='Click gần nhất phải chờ' value={clickDelay == null ? '–' : `${clickDelay}ms`} />
        <Stat label='Bắt đầu việc idle' value={idleAt == null ? '–' : `t=${idleAt}ms`} />
      </div>
      <div className='tti-timeline' role='img' aria-label='Timeline các việc phụ lúc khởi động'>
        {bars.map((bar) => (
          <div key={bar.name} className='tti-row'>
            <span className='tti-name'>
              {bar.name}
              {bar.idle && <span className='tti-chip idle'>idle</span>}
              {bar.monkey && <span className='tti-chip monkey'>🐒</span>}
            </span>
            <span className='tti-track'>
              {bar.start >= 0 && (
                <span
                  className='tti-net'
                  style={{
                    left: `${(bar.start / SCALE_MS) * 100}%`,
                    width: `${(((bar.cpuStart ?? bar.start) - bar.start) / SCALE_MS) * 100}%`,
                  }}
                />
              )}
              {bar.cpuStart != null && (
                <span
                  className={`tti-cpu${mode === 'naive' ? ' bad' : ''}`}
                  style={{
                    left: `${(bar.cpuStart / SCALE_MS) * 100}%`,
                    width: `max(2px, ${(((bar.end ?? bar.cpuStart) - bar.cpuStart) / SCALE_MS) * 100}%)`,
                  }}
                />
              )}
            </span>
          </div>
        ))}
        {bars.length > 0 && (
          <div className='tti-row tti-axis'>
            <span className='tti-name muted'>
              <span className='tti-legend net' /> tải <span className='tti-legend cpu' /> CPU
            </span>
            <span className='tti-track muted'>
              <span>0</span>
              <span>2,5s</span>
              <span>5s</span>
            </span>
          </div>
        )}
      </div>
      <Log lines={lines} />
    </div>
  );
}
