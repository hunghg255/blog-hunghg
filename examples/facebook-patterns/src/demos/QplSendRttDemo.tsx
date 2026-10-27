import { useMemo, useRef, useState } from 'react';
import { generateOtid } from '../lib/otid';
import { createQpl, createSendRttTracker, SEND_MESSAGE, type QplEvent } from '../lib/qpl';
import { Log, Stat, useLog } from './shared';
import './QplSendRttDemo.css';

const MODULE_LOAD_MS = 300;

interface Row {
  otid: string;
  real?: number;
  measured?: number | 'mất';
}

export default function QplSendRttDemo() {
  const { lines, add, clear } = useLog(40);
  const [fbStyle, setFbStyle] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [active, setActive] = useState(0);
  const [rate, setRate] = useState(10);
  const [sampling, setSampling] = useState<{ sent: number; measured: number } | null>(null);
  const [loss, setLoss] = useState<{ starts: number; ends: number } | null>(null);

  // mỗi lần đổi chế độ là một "phiên" mới: module QPL chưa được tải
  const session = useMemo(() => {
    const qpl = createQpl({
      sampleRate: () => 1,
      send: (event: QplEvent) => {
        if (event.kind === 'marker') {
          setRows((rs) => rs.map((r) => (r.otid === event.instanceKey ? { ...r, measured: event.value } : r)));
        }
      },
    });
    return { qpl, tracker: createSendRttTracker(qpl), moduleLoaded: false };
  }, [fbStyle]);
  const clickTimes = useRef(new Map<string, number>());

  function send() {
    const otid = generateOtid();
    const clickedAt = performance.now();
    clickTimes.current.set(otid, clickedAt);
    setRows((rs) => [{ otid }, ...rs].slice(0, 8));
    const latency = 120 + Math.random() * 300;

    if (fbStyle) {
      // markerStart nằm TRONG callback tải module, timestamp mặc định = lúc callback chạy
      const start = () => {
        session.qpl.markerStart(SEND_MESSAGE, otid);
        setActive(session.qpl.activeCount);
      };
      if (session.moduleLoaded) queueMicrotask(start);
      else
        setTimeout(() => {
          session.moduleLoaded = true;
          start();
          add(`module QPL tải xong sau ${MODULE_LOAD_MS}ms, mới bắt đầu đo`, 'warn');
        }, MODULE_LOAD_MS);
    } else {
      session.tracker.onSend(otid);
    }

    setTimeout(() => {
      const real = Math.round(performance.now() - clickedAt);
      // tin của chính mình dội về qua sync: timestamp chụp ngay tại đây (cả hai cách)
      const measured = session.tracker.onEcho(otid);
      setRows((rs) => rs.map((r) => (r.otid === otid ? { ...r, real, measured: measured ?? 'mất' } : r)));
      if (measured === undefined) add(`…${otid.slice(-6)}: tin dội về TRƯỚC khi marker bắt đầu, phép đo bị mất`, 'err');
      setActive(session.qpl.activeCount);
    }, latency);
  }

  function simulateSampling() {
    let measured = 0;
    const qpl = createQpl({ sampleRate: () => rate, send: () => measured++ });
    for (let i = 0; i < 1000; i++) {
      if (qpl.markerStart(SEND_MESSAGE, i, { timestamp: 0 })) qpl.markerEnd(SEND_MESSAGE, 'SUCCESS', i, 100);
    }
    setSampling({ sent: 1000, measured });
  }

  function simulateLoss() {
    let starts = 0;
    let ends = 0;
    const qpl = createQpl({
      sampleRate: () => 1,
      send: (e) => (e.kind === 'loss-start' ? starts++ : ends++),
    });
    for (let i = 0; i < 1000; i++) {
      qpl.markerStart(SEND_MESSAGE, i, { timestamp: 0, trackedForLoss: true });
      // 7% người dùng đóng tab trước khi tin dội về: markerEnd không bao giờ chạy
      if (Math.random() > 0.07) qpl.markerEnd(SEND_MESSAGE, 'SUCCESS', i, 200);
    }
    setLoss({ starts, ends });
  }

  return (
    <div className='page qpl-demo'>
      <h1>QPL: đo RTT gửi tin đầu-cuối</h1>
      <p className='hint'>
        Bấm gửi → <code>markerStart(SEND_MESSAGE, otid)</code>. Tin của chính mình dội về qua sync →{' '}
        <code>markerEnd(…, otid)</code>. Cùng OTID nên hai đầu khớp nhau, đo được độ trễ thật người dùng cảm nhận.
      </p>

      <section className='card'>
        <div className='toolbar' role='group' aria-label='Cách bắt đầu marker'>
          <button className={!fbStyle ? 'primary' : ''} aria-pressed={!fbStyle} onClick={() => (setFbStyle(false), setRows([]), clear())}>
            Chụp timestamp lúc bấm
          </button>
          <button className={fbStyle ? 'primary' : ''} aria-pressed={fbStyle} onClick={() => (setFbStyle(true), setRows([]), clear())}>
            Kiểu Facebook (start trong callback tải module)
          </button>
        </div>
        <div className='toolbar'>
          <button className='primary' onClick={send}>
            Gửi tin
          </button>
          <span className='muted'>marker đang treo: <bdi data-testid='active'>{active}</bdi></span>
          <button onClick={() => (session.qpl.sweep(5000), setActive(session.qpl.activeCount))}>Dọn marker treo &gt; 5s</button>
        </div>
        <table className='rtt-table' data-testid='rtt'>
          <thead>
            <tr>
              <th>tin</th>
              <th>RTT thật</th>
              <th>QPL đo được</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.otid}>
                <td>…{r.otid.slice(-6)}</td>
                <td>{r.real === undefined ? '…' : `${r.real}ms`}</td>
                <td className={typeof r.measured === 'number' && r.real !== undefined && r.real - r.measured > 50 ? 'err' : r.measured === 'mất' ? 'err' : ''}>
                  {r.measured === undefined ? '…' : typeof r.measured === 'number' ? `${r.measured}ms` : r.measured}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className='card'>
        <h2>Lấy mẫu 1/N quyết định lúc start</h2>
        <div className='toolbar' role='group' aria-label='Tỷ lệ lấy mẫu'>
          {[1, 10, 100].map((n) => (
            <button key={n} className={rate === n ? 'primary' : ''} aria-pressed={rate === n} onClick={() => setRate(n)}>
              1/{n}
            </button>
          ))}
          <button onClick={simulateSampling}>Mô phỏng 1000 lần gửi</button>
        </div>
        {sampling && (
          <div className='stats'>
            <Stat label='lần gửi' value={sampling.sent} />
            <Stat label='được đo (gửi event)' value={<bdi data-testid='measured'>{sampling.measured}</bdi>} />
          </div>
        )}
      </section>

      <section className='card'>
        <h2>trackedForLoss: bao nhiêu phép đo bị rơi?</h2>
        <div className='toolbar'>
          <button onClick={simulateLoss}>Mô phỏng 1000 lần gửi, 7% tab đóng giữa chừng</button>
        </div>
        {loss && (
          <div className='stats'>
            <Stat label='event start' value={loss.starts} />
            <Stat label='event end' value={loss.ends} />
            <Stat label='tỷ lệ mất' value={<bdi data-testid='loss'>{`${(100 - (loss.ends / loss.starts) * 100).toFixed(1)}%`}</bdi>} />
          </div>
        )}
      </section>

      <Log lines={lines} />
    </div>
  );
}
