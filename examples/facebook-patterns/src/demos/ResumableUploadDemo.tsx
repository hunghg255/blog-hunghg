import { useMemo, useRef, useState } from 'react';
import { resumableUpload, StallMonitor, TransientError, type UploadEvent, type UploadTransport } from '../lib/resumableUpload';
import { Log, Stat, sleep, useLog } from './shared';
import './ResumableUploadDemo.css';

const FILE_BYTES = 6 * 1024 * 1024;
const CHUNK = 64 * 1024;
const SPEED_BPS = 12_000_000;
const RTT = 120;

type Net = { state: 'up' | 'hang'; errorEpoch: number };

/** Server giả: lưu số byte đã nhận theo phiên, nhớ hash của file đã upload xong. */
function createFakeServer(net: { current: Net }) {
  const sessions = new Map<string, { received: number; size: number; hash: string | null }>();
  const done = new Map<string, string>();
  let seq = 0;
  const transport: UploadTransport = {
    async start({ size, hash }) {
      await sleep(RTT);
      if (hash && done.has(hash)) return { sessionKey: '', skipUpload: true, handle: done.get(hash)! };
      const sessionKey = `s${++seq}`;
      sessions.set(sessionKey, { received: 0, size, hash });
      return { sessionKey };
    },
    async getOffset(key) {
      await sleep(RTT);
      if (net.current.state === 'hang') throw new TransientError('GET offset: không có mạng');
      return sessions.get(key)!.received;
    },
    send(key, body, offset, _total, onProgress, signal) {
      return new Promise((resolve, reject) => {
        const s = sessions.get(key)!;
        const epoch = net.current.errorEpoch;
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        if (offset !== s.received) s.received = offset; // server chấp nhận gửi lại từ offset nhỏ hơn
        (async () => {
          let sent = 0;
          while (sent < body.size && !signal.aborted) {
            if (net.current.errorEpoch !== epoch) return reject(new TransientError('Mất kết nối giữa chừng'));
            if (net.current.state === 'hang') {
              await sleep(50); // gói tin không đi, cũng không có lỗi: request treo
              continue;
            }
            const n = Math.min(CHUNK, body.size - sent);
            await sleep((n * 8 * 1000) / SPEED_BPS);
            if (signal.aborted) return;
            sent += n;
            s.received = offset + sent;
            onProgress(sent);
          }
          if (signal.aborted) return;
          await sleep(RTT);
          if (s.hash) done.set(s.hash, `video_${key}`);
          resolve({ handle: `video_${key}` });
        })();
      });
    },
  };
  return transport;
}

function makeFile() {
  const bytes = new Uint8Array(FILE_BYTES);
  for (let i = 0; i < bytes.length; i += 65536) crypto.getRandomValues(bytes.subarray(i, i + 65536));
  return new File([bytes], 'holiday.mp4', { type: 'video/mp4' });
}

interface LaneState {
  sent: number;
  bytesOnWire: number;
  retries: number;
  status: string;
  tone: 'ok' | 'warn' | 'err' | 'muted';
  ms: number;
}

const EMPTY: LaneState = { sent: 0, bytesOnWire: 0, retries: 0, status: 'chưa chạy', tone: 'muted', ms: 0 };
const mb = (n: number) => `${(n / 1024 / 1024).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} MB`;

export default function ResumableUploadDemo() {
  const { lines, add } = useLog(60);
  const file = useMemo(makeFile, []);
  const net = useRef<Net>({ state: 'up', errorEpoch: 0 });
  const networkEvents = useRef(new EventTarget());
  const server = useRef(createFakeServer(net));
  const [lanes, setLanes] = useState<{ naive: LaneState; resume: LaneState }>({ naive: EMPTY, resume: EMPTY });
  const [netState, setNetState] = useState<Net['state']>('up');
  const [running, setRunning] = useState(false);

  const setNet = (state: Net['state']) => {
    net.current.state = state;
    setNetState(state);
    if (state === 'up') networkEvents.current.dispatchEvent(new Event('online'));
    add(state === 'up' ? 'Mạng: có lại (sự kiện online)' : 'Mạng: rớt, gói tin không đi nhưng cũng không có lỗi', state === 'up' ? 'ok' : 'warn');
  };
  const breakConnection = () => {
    net.current.errorEpoch++;
    add('Mạng: kết nối bị cắt, request đang chạy báo lỗi', 'err');
  };

  const runLane = (key: 'naive' | 'resume', blob: Blob) => {
    const t0 = performance.now();
    const patch = (p: Partial<LaneState>) => setLanes((l) => ({ ...l, [key]: { ...l[key], ...p, ms: performance.now() - t0 } }));
    patch({ ...EMPTY, status: 'đang băm…', tone: 'muted' });
    const label = key === 'naive' ? 'Gửi lại từ đầu' : 'Tiếp tục từ offset';
    const onEvent = (e: UploadEvent) => {
      if (e.type === 'progress') patch({ sent: e.sent, status: 'đang gửi', tone: 'muted' });
      else if (e.type === 'resume' && e.attempt > 0)
        add(key === 'naive' ? `${label}: thử lại lần ${e.attempt}, gửi lại từ byte 0` : `${label}: thử lại lần ${e.attempt}, server đã có ${mb(e.offset)} → gửi từ byte ${e.offset}`);
      else if (e.type === 'retry') {
        setLanes((l) => ({ ...l, [key]: { ...l[key], retries: e.attempt, status: `chờ ${e.delayMs} ms`, tone: 'warn' } }));
        add(`${label}: ${e.reason}, thử lại sau ${e.delayMs} ms (hoặc ngay khi có mạng)`, 'warn');
      } else if (e.type === 'hashed' && e.hash) add(`${label}: SHA-256 ${e.hash?.slice(0, 12)}… (${Math.round(e.ms)} ms)`, 'muted');
      else if (e.type === 'skipped') add(`${label}: server đã có file cùng hash, bỏ qua upload`, 'ok');
      else if (e.type === 'done') {
        patch({ sent: blob.size, bytesOnWire: e.bytesSent, status: e.bytesSent ? 'xong' : 'xong (dedupe, 0 byte)', tone: 'ok' });
        add(`${label}: xong, ${mb(e.bytesSent)} đi qua mạng`, 'ok');
      } else if (e.type === 'failed') {
        patch({ status: `thất bại: ${e.error}`, tone: 'err' });
        add(`${label}: thất bại: ${e.error}`, 'err');
      }
    };
    const monitor = new StallMonitor(2000, networkEvents.current);
    return resumableUpload(blob, server.current, {
      resume: key === 'resume',
      monitor,
      hashMaxBytes: key === 'resume' ? 50 * 1024 * 1024 : 0,
      backoff: { base: 2, capMs: 4000 },
      onEvent,
    }).promise.finally(() => monitor.dispose());
  };

  const scenario = async () => {
    setRunning(true);
    server.current = createFakeServer(net);
    net.current = { state: 'up', errorEpoch: 0 };
    setNetState('up');
    const all = Promise.all([runLane('naive', file), runLane('resume', file)]);
    await sleep(1500);
    setNet('hang');
    await sleep(3500);
    setNet('up');
    await sleep(1800);
    breakConnection();
    await all;
    setRunning(false);
  };

  const again = async () => {
    setRunning(true);
    await runLane('resume', file);
    setRunning(false);
  };

  return (
    <div className='page rup'>
      <h1>Upload tiếp tục được</h1>
      <p className='hint'>
        Hai upload cùng một file {mb(FILE_BYTES)} chạy song song qua một "mạng" {SPEED_BPS / 1e6} Mbps. Kịch bản: giây 1,5 mạng treo (không lỗi, chỉ đứng im), giây 5
        có lại, giây 6,8 kết nối bị cắt. Một bên mỗi lần lỗi gửi lại từ đầu, một bên hỏi server offset rồi gửi tiếp.
      </p>
      <div className='toolbar'>
        <button className='primary' onClick={scenario} disabled={running}>
          Chạy kịch bản
        </button>
        <button onClick={again} disabled={running}>
          Upload lại cùng file
        </button>
        <button onClick={() => setNet(netState === 'up' ? 'hang' : 'up')} disabled={!running}>
          {netState === 'up' ? 'Rớt mạng' : 'Có mạng lại'}
        </button>
        <button onClick={breakConnection} disabled={!running}>
          Cắt kết nối
        </button>
      </div>
      {(['naive', 'resume'] as const).map((key) => {
        const l = lanes[key];
        return (
          <div className='card rup-lane' key={key}>
            <div className='rup-head'>
              <b>{key === 'naive' ? 'Ngây thơ: lỗi là gửi lại từ đầu' : 'Kiểu rupload: GET offset rồi gửi tiếp'}</b>
              <span className={l.tone}>{l.status}</span>
            </div>
            <div className='rup-bar' role='progressbar' aria-valuemin={0} aria-valuemax={FILE_BYTES} aria-valuenow={l.sent}>
              <span className={key} style={{ width: `${(l.sent / FILE_BYTES) * 100}%` }} />
            </div>
            <div className='stats'>
              <Stat label='Đã lên server' value={mb(l.sent)} />
              <Stat label='Byte đi qua mạng' value={l.bytesOnWire ? mb(l.bytesOnWire) : '—'} />
              <Stat label='Lần thử lại' value={l.retries} />
              <Stat label='Thời gian' value={`${(l.ms / 1000).toFixed(1)} s`} />
            </div>
          </div>
        );
      })}
      <Log lines={lines} />
    </div>
  );
}
