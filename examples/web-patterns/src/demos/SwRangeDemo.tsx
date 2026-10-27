import { useEffect, useMemo, useRef, useState } from 'react';
import {
  PART_SIZE,
  ensureRangeWorker,
  parseRange,
  registerMedia,
  startPartResponder,
  unregisterMedia,
  unregisterRangeWorker,
  type WorkerStatus,
} from '../lib/swRange';
import { Log, Stat, useLog } from './shared';
import './SwRangeDemo.css';

const RATE = 22050;
const SECONDS = 90;
const HEADER = 44;

/** Tạo file WAV (PCM 16-bit mono) chơi một giai điệu ngũ cung, ~3.9MB. */
function makeMelodyWav(): ArrayBuffer {
  const samples = RATE * SECONDS;
  const buffer = new ArrayBuffer(HEADER + samples * 2);
  const view = new DataView(buffer);
  const str = (offset: number, s: string) => [...s].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  view.setUint32(4, 36 + samples * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, RATE, true);
  view.setUint32(28, RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  str(36, 'data');
  view.setUint32(40, samples * 2, true);
  const scale = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25];
  const noteLen = RATE / 4;
  for (let i = 0; i < samples; i++) {
    const note = Math.floor(i / noteLen);
    const freq = scale[(note * 7 + (note >> 3)) % scale.length] * (note % 16 < 8 ? 1 : 0.5);
    const t = (i % noteLen) / noteLen;
    const env = Math.min(1, t * 20) * (1 - t) ** 2;
    const s = Math.sin((2 * Math.PI * freq * i) / RATE) * env * 0.3;
    view.setInt16(HEADER + i * 2, s * 0x7fff, true);
  }
  return buffer;
}

const EXAMPLES = ['bytes=0-', 'bytes=0-1', 'bytes=1048576-', 'bytes=100-199', 'bytes=-1000', 'bytes=999999999-', null];

type PartSource = 'page' | 'cache';

export default function SwRangeDemo() {
  const { lines, add } = useLog(80);
  const wav = useMemo(makeMelodyWav, []);
  const totalParts = Math.ceil(wav.byteLength / PART_SIZE);
  const [status, setStatus] = useState<WorkerStatus | 'idle' | 'registering'>(() =>
    !('serviceWorker' in navigator) ? 'unsupported' : navigator.serviceWorker.controller?.scriptURL.endsWith('sw-range.js') ? 'controlled' : 'idle',
  );
  const [delay, setDelay] = useState(300);
  const delayRef = useRef(delay);
  delayRef.current = delay;
  const [parts, setParts] = useState<Record<number, PartSource>>({});
  const [buffered, setBuffered] = useState<Array<[number, number]>>([]);
  const [src, setSrc] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  // Trả lời yêu cầu từ SW
  useEffect(() => {
    return startPartResponder({
      delay: () => delayRef.current,
      onRequest: (req) => setParts((p) => ({ ...p, [Math.floor(req.start / PART_SIZE)]: 'page' })),
      onLog: (log) => {
        add(`SW: ${log.text}`, log.tone);
        const m = / → 206 (\d+)-/.exec(log.text);
        if (m && log.text.includes('Cache Storage')) setParts((p) => ({ ...p, [Math.floor(Number(m[1]) / PART_SIZE)]: 'cache' }));
      },
    });
  }, [add]);

  // Chọn nguồn phát: qua SW nếu SW đang điều khiển trang, ngược lại Blob URL bình thường
  useEffect(() => {
    if (status === 'controlled') {
      setSrc(registerMedia('melody', wav, 'audio/wav'));
      return () => unregisterMedia('melody');
    }
    if (status === 'unsupported' || status === 'error' || status === 'needs-reload') {
      const url = URL.createObjectURL(new Blob([wav], { type: 'audio/wav' }));
      setSrc(url);
      return () => URL.revokeObjectURL(url);
    }
    setSrc(null);
  }, [status, wav]);

  const enable = async () => {
    setStatus('registering');
    const result = await ensureRangeWorker();
    setStatus(result);
    add(
      result === 'controlled'
        ? 'Service worker đã điều khiển trang. Bấm ▶ trên trình phát.'
        : result === 'needs-reload'
          ? 'SW đã cài nhưng chưa điều khiển trang (vừa tải lại cứng?). Tải lại trang thường để dùng.'
          : 'Không đăng ký được service worker ở đây: phát bằng Blob URL thay thế.',
      result === 'controlled' ? 'ok' : 'warn',
    );
  };

  const updateBuffered = () => {
    const a = audioRef.current;
    if (!a) return;
    const out: Array<[number, number]> = [];
    for (let i = 0; i < a.buffered.length; i++) out.push([a.buffered.start(i) / SECONDS, a.buffered.end(i) / SECONDS]);
    setBuffered(out);
  };

  const viaSw = status === 'controlled';

  return (
    <div className='page'>
      <h1>Phát media qua Service Worker</h1>
      <p className='hint'>
        File WAV {(wav.byteLength / 1024 / 1024).toFixed(1)}MB nằm trong bộ nhớ của trang. Thẻ <code>&lt;audio&gt;</code>{' '}
        gửi request <code>Range</code>; service worker hỏi lại trang từng phần {PART_SIZE / 1024}KB qua postMessage rồi trả
        206. Phát thử, tua, rồi tải lại trang và phát lần nữa: 2MB đầu lấy từ Cache Storage.
      </p>
      <div className='toolbar'>
        {status !== 'controlled' && status !== 'unsupported' && (
          <button className='primary' onClick={enable} disabled={status === 'registering'} data-testid='enable-sw'>
            {status === 'registering' ? 'Đang đăng ký…' : 'Bật service worker'}
          </button>
        )}
        <span className={`badge ${viaSw ? 'ok' : 'err'}`} data-testid='sw-status'>
          {
            {
              idle: 'chưa bật SW',
              registering: 'đang đăng ký',
              controlled: 'SW đang điều khiển trang',
              'needs-reload': 'cần tải lại trang',
              unsupported: 'không hỗ trợ SW: phát bằng Blob URL',
              error: 'đăng ký lỗi: phát bằng Blob URL',
            }[status]
          }
        </span>
        <label>
          Mạng chậm{' '}
          <select value={delay} onChange={(e) => setDelay(Number(e.target.value))}>
            {[0, 300, 900].map((n) => (
              <option key={n} value={n}>
                {n}ms / phần
              </option>
            ))}
          </select>
        </label>
      </div>

      {src ? (
        <audio
          ref={audioRef}
          className='swr-audio'
          controls
          preload='metadata'
          src={src}
          onProgress={updateBuffered}
          onTimeUpdate={updateBuffered}
          onError={() => add('Trình phát báo lỗi khi tải media', 'err')}
          data-testid='audio'
        />
      ) : (
        <p className='muted'>Bật service worker để phát qua SW.</p>
      )}

      <div className='toolbar'>
        <button
          disabled={!src}
          onClick={() => {
            const a = audioRef.current!;
            a.currentTime = SECONDS * 0.75;
            void a.play();
          }}
        >
          Tua tới 75%
        </button>
        <button
          onClick={async () => {
            const names = (await caches.keys()).filter((n) => n.startsWith('sw-range-'));
            await Promise.all(names.map((n) => caches.delete(n)));
            setParts({});
            add(`Đã xoá cache: ${names.join(', ') || '(trống)'}`, 'muted');
          }}
          disabled={typeof caches === 'undefined'}
        >
          Xoá cache
        </button>
        {viaSw && (
          <a className='btn' href='./sw-range/old-link?theme=dark#/sw-range' target='_blank' rel='noopener'>
            Link cũ → JS redirect giữ #hash ↗
          </a>
        )}
        {status !== 'idle' && status !== 'unsupported' && (
          <button
            onClick={async () => {
              const removed = await unregisterRangeWorker();
              add(removed ? 'Đã gỡ service worker (tải lại trang để trang thoát khỏi SW)' : 'Không có SW để gỡ', 'muted');
              setStatus('idle');
            }}
          >
            Gỡ SW
          </button>
        )}
      </div>

      <div className='stats'>
        <Stat label='phần lấy từ trang' value={<output data-testid='from-page'>{Object.values(parts).filter((p) => p === 'page').length}</output>} />
        <Stat label='phần từ Cache Storage' value={Object.values(parts).filter((p) => p === 'cache').length} />
        <Stat label='tổng số phần của file' value={totalParts} />
      </div>

      <div className='swr-file' aria-label='Các phần của file và vùng trình phát đã đệm'>
        <div className='swr-parts'>
          {Array.from({ length: totalParts }, (_, i) => (
            <span key={i} className={parts[i] ? `swr-${parts[i]}` : ''} title={`Phần ${i}`} />
          ))}
        </div>
        <div className='swr-buffered'>
          {buffered.map(([a, b], i) => (
            <span key={i} style={{ left: `${a * 100}%`, width: `${(b - a) * 100}%` }} />
          ))}
        </div>
        <small className='muted'>Trên: phần đã gửi (cam = từ trang, xanh = từ cache). Dưới: vùng audio.buffered.</small>
      </div>

      <details className='swr-table'>
        <summary>parseRange: header Range → đoạn byte SW trả về</summary>
        <table>
          <tbody>
            {EXAMPLES.map((h) => {
              const r = parseRange(h, wav.byteLength);
              return (
                <tr key={String(h)}>
                  <td>
                    <code>{h ?? '(không có)'}</code>
                  </td>
                  <td>{r === 'unsatisfiable' ? <span className='err'>416</span> : `206 bytes ${r.start}-${r.end}/${wav.byteLength}`}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </details>

      <Log lines={lines} />
    </div>
  );
}
