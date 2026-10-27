import { useEffect, useRef, useState } from 'react';
import {
  decodedBytes,
  detectPlatform,
  forcePlay,
  watchBandwidth,
  type BandwidthSample,
  type PlatformInput,
} from '../lib/udVideoQuirks';
import { Log, Stat, useLog } from './shared';
import './UdVideoQuirksDemo.css';

/** Tạo một video webm ngắn ngay trong trình duyệt (canvas + MediaRecorder), không tải file ngoài. */
async function makeVideo(seconds = 4): Promise<string> {
  const canvas = document.createElement('canvas');
  canvas.width = 480;
  canvas.height = 270;
  const ctx = canvas.getContext('2d')!;
  const stream = canvas.captureStream(30);
  const recorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const stopped = new Promise((r) => (recorder.onstop = r));
  recorder.start(250);
  const start = performance.now();
  await new Promise<void>((resolve) => {
    const draw = (now: number) => {
      const t = (now - start) / 1000;
      ctx.fillStyle = `hsl(${(t * 90) % 360} 70% 35%)`;
      ctx.fillRect(0, 0, 480, 270);
      for (let i = 0; i < 40; i++) {
        ctx.fillStyle = `hsl(${(i * 37 + t * 120) % 360} 80% 60%)`;
        ctx.fillRect((i * 53 + t * 140) % 480, (i * 29) % 270, 24, 24);
      }
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 28px sans-serif';
      ctx.fillText(`Udemy demo ${t.toFixed(1)}s`, 20, 250);
      if (t < seconds) requestAnimationFrame(draw);
      else resolve();
    };
    requestAnimationFrame(draw);
  });
  recorder.stop();
  await stopped;
  return URL.createObjectURL(new Blob(chunks, { type: 'video/webm' }));
}

/** Bản mô phỏng Watermark gốc (không phải mã của Udemy): không kiểm tra NaN, mẫu đầu tính từ 0. */
class OriginalWatermark {
  highest = 0;
  lastTotal = 0;
  add(newTotal: number, secs: number) {
    const sample = (newTotal - this.lastTotal) / secs;
    if (sample > this.highest) this.highest = sample;
    this.lastTotal = newTotal;
  }
}

/** Mô phỏng forcePlay gốc: giữ promise đã xong mãi mãi, nên lần gọi thứ hai không làm gì. */
function makeOriginalForcePlay(video: HTMLVideoElement) {
  let cached: Promise<void> | undefined;
  return () => {
    if (cached) return { promise: cached, reused: true };
    cached = new Promise<void>((resolve) => {
      const wasMuted = video.muted;
      const wasPaused = video.paused;
      video.muted = true;
      video.play().catch(() => {});
      let retry = 0;
      const id = setInterval(() => {
        if (video.readyState >= 4 || ++retry >= 100) {
          clearInterval(id);
          resolve();
          if (wasPaused) video.pause();
          video.muted = wasMuted;
        } else if (video.paused) video.play().catch(() => {});
      }, 100);
    });
    return { promise: cached, reused: false };
  };
}

const PRESETS: Array<PlatformInput & { name: string }> = [
  {
    name: 'iPad (iPadOS 17, Safari mặc định)',
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
    platform: 'MacIntel',
    maxTouchPoints: 5,
  },
  {
    name: 'MacBook (macOS)',
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
    platform: 'MacIntel',
    maxTouchPoints: 0,
  },
  {
    name: 'iPhone (iOS 17)',
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    platform: 'iPhone',
    maxTouchPoints: 5,
  },
  {
    name: 'Máy tính bảng Android',
    userAgent:
      'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36',
    platform: 'Linux armv8l',
    maxTouchPoints: 10,
  },
];

/** Mô phỏng cách bản gốc xử lý (ua-parser + vá tên OS sau khi đã tính isMobile). */
function originalPlatform(p: PlatformInput) {
  const iPhone = /iPhone/.test(p.userAgent);
  const mac = /Mac OS X/.test(p.userAgent) && !iPhone;
  let name = iPhone ? 'iOS' : mac ? 'Mac OS' : /Android/.test(p.userAgent) ? 'Android' : 'other';
  const version = (p.userAgent.match(/(?:Mac OS X|iPhone OS|Android) (\d+[_.\d]*)/)?.[1] ?? '').replace(/_/g, '.');
  const isMobile = iPhone || (/Android/.test(p.userAgent) && /Mobile/.test(p.userAgent));
  if (name === 'Mac OS' && p.platform === 'MacIntel' && p.maxTouchPoints > 1) name = 'iOS';
  return { name, version, isMobile };
}

const kb = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? '—' : `${Math.round(n / 1024)} KB/s`);

export default function UdVideoQuirksDemo() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [status, setStatus] = useState('Đang tạo video bằng canvas…');
  const [noCounters, setNoCounters] = useState(false);
  const [sample, setSample] = useState<BandwidthSample | null>(null);
  const [original, setOriginal] = useState<{ highest: number; last: number }>({ highest: 0, last: 0 });
  const [blockAutoplay, setBlockAutoplay] = useState(false);
  const [ready, setReady] = useState('0');
  const originalForcePlay = useRef<ReturnType<typeof makeOriginalForcePlay> | null>(null);
  const originalWatermark = useRef<OriginalWatermark | null>(null);
  const log = useLog(40);

  useEffect(() => {
    if (typeof MediaRecorder === 'undefined' || !HTMLCanvasElement.prototype.captureStream) {
      setStatus('Trình duyệt này không có MediaRecorder/captureStream: không tạo được video thử.');
      return;
    }
    let url: string | undefined;
    makeVideo().then((u) => {
      url = u;
      setSrc(u);
      setStatus('Video 4 giây đã sẵn sàng (blob webm).');
    });
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, []);

  // đo băng thông: cả bản viết lại lẫn bản mô phỏng gốc
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;
    const read = (v: HTMLVideoElement) => (noCounters ? undefined : decodedBytes(v));
    const stop = watchBandwidth(video, setSample, { readBytes: read });
    // giữ một watermark "kiểu gốc" cho cả đời video, như plugin của player
    const orig = (originalWatermark.current ??= new OriginalWatermark());
    let last = performance.now();
    const id = setInterval(() => {
      const now = performance.now();
      const v = video as HTMLVideoElement & { webkitAudioDecodedByteCount?: number; webkitVideoDecodedByteCount?: number };
      // bản gốc: cộng thẳng hai thuộc tính, trình duyệt không có thì ra NaN
      const total = noCounters
        ? (undefined as unknown as number) + (undefined as unknown as number)
        : (v.webkitAudioDecodedByteCount ?? 0) + (v.webkitVideoDecodedByteCount ?? 0);
      orig.add(total, (now - last) / 1000);
      last = now;
      setOriginal({ highest: orig.highest, last: orig.lastTotal });
    }, 1000);
    return () => {
      stop();
      clearInterval(id);
    };
  }, [src, noCounters]);

  useEffect(() => {
    const id = setInterval(() => setReady(String(videoRef.current?.readyState ?? 0)), 200);
    return () => clearInterval(id);
  }, []);

  // giả lập trình duyệt chặn tự phát (kể cả khi tắt tiếng)
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const realPlay = HTMLMediaElement.prototype.play;
    if (blockAutoplay) {
      video.play = () => Promise.reject(new DOMException('play() bị chặn (giả lập)', 'NotAllowedError'));
    } else {
      video.play = realPlay;
    }
    return () => {
      video.play = realPlay;
    };
  }, [blockAutoplay, src]);

  const reload = () => {
    const video = videoRef.current;
    if (!video || !src) return;
    video.pause();
    video.removeAttribute('src');
    video.load();
    video.src = src;
    video.load();
    originalForcePlay.current = null;
    log.add('Tải lại video (readyState về 0)', 'muted');
  };

  const runOurs = async () => {
    const video = videoRef.current!;
    const muted = video.muted;
    log.add(`forcePlay (viết lại): bắt đầu, muted=${muted}, paused=${video.paused}`);
    const result = await forcePlay(video, { timeoutMs: 5000 });
    log.add(
      `forcePlay (viết lại): ${result}, readyState=${video.readyState}, muted trả về ${video.muted}, paused=${video.paused}`,
      result === 'ready' ? 'ok' : 'warn',
    );
  };

  const runOriginal = async () => {
    const video = videoRef.current!;
    originalForcePlay.current ??= makeOriginalForcePlay(video);
    const { promise, reused } = originalForcePlay.current();
    if (reused) {
      log.add('forcePlay (kiểu gốc): trả lại promise CŨ đã xong, không làm gì', 'err');
      return;
    }
    await promise;
    log.add(`forcePlay (kiểu gốc): xong, readyState=${video.readyState}, muted=${video.muted}`, 'ok');
  };

  return (
    <div className='page ud-quirks'>
      <h1>Mẹo quanh thẻ video: băng thông, forcePlay, iPad giả Mac</h1>
      <p className='hint'>{status}</p>

      <section className='card'>
        <h2>1. Đo băng thông bằng bộ đếm byte đã giải mã</h2>
        <video ref={videoRef} src={src ?? undefined} controls playsInline loop className='ud-quirks-video' data-testid='video' />
        <div className='toolbar'>
          <button className='primary' onClick={() => videoRef.current?.play()} disabled={!src}>
            ▶ Phát
          </button>
          <label>
            <input type='checkbox' checked={noCounters} onChange={(e) => setNoCounters(e.target.checked)} data-testid='no-counters' />{' '}
            giả lập trình duyệt không có <code>webkit*DecodedByteCount</code> (Firefox)
          </label>
        </div>
        <div className='stats'>
          <Stat label='mẫu gần nhất (viết lại)' value={<bdi>{kb(sample?.decoderBytesPerSec)}</bdi>} />
          <Stat label='cao nhất (viết lại)' value={<bdi data-testid='ours-high'>{kb(sample?.highest.decoderBytesPerSec)}</bdi>} />
          <Stat label='cao nhất (kiểu gốc)' value={<bdi data-testid='orig-high'>{kb(original.highest)}</bdi>} />
          <Stat label='lastTotal kiểu gốc' value={<bdi data-testid='orig-last'>{String(original.last)}</bdi>} />
          <Stat
            label='buffer: ms media / giây'
            value={<bdi>{sample?.highest.bufferedMsPerSec ? Math.round(sample.highest.bufferedMsPerSec) : '—'}</bdi>}
          />
        </div>
      </section>

      <section className='card'>
        <h2>2. forcePlay: tắt tiếng → phát → chờ đủ dữ liệu → trả trạng thái cũ</h2>
        <div className='toolbar'>
          <button onClick={reload} disabled={!src}>
            Tải lại video
          </button>
          <button className='primary' onClick={runOurs} disabled={!src} data-testid='force-ours'>
            forcePlay (viết lại)
          </button>
          <button onClick={runOriginal} disabled={!src} data-testid='force-orig'>
            forcePlay (kiểu gốc)
          </button>
          <label>
            <input type='checkbox' checked={blockAutoplay} onChange={(e) => setBlockAutoplay(e.target.checked)} data-testid='block' /> giả lập
            chặn play()
          </label>
          <span className='badge'>
            readyState <bdi data-testid='ready'>{ready}</bdi>
          </span>
        </div>
        <Log lines={log.lines} />
      </section>

      <section className='card'>
        <h2>3. iPad báo mình là Mac</h2>
        <div className='ud-quirks-table-wrap'>
          <table className='ud-quirks-table'>
            <thead>
              <tr>
                <th>Thiết bị</th>
                <th>Kiểu gốc: OS / phiên bản / mobile</th>
                <th>Viết lại</th>
              </tr>
            </thead>
            <tbody>
              {PRESETS.map((p) => {
                const o = originalPlatform(p);
                const r = detectPlatform(p);
                return (
                  <tr key={p.name} data-testid='platform-row'>
                    <td>
                      {p.name}
                      <br />
                      <small>
                        platform={p.platform}, maxTouchPoints={p.maxTouchPoints}
                      </small>
                    </td>
                    <td>
                      {o.name} {o.version || '?'} / {o.isMobile ? 'mobile' : 'không'}
                    </td>
                    <td>
                      {r.os} {r.version ?? '(không rõ)'} / {r.isTablet ? 'tablet' : r.isMobile ? 'mobile' : 'desktop'}
                      {r.spoofedDesktopUA ? ' · UA giả Mac' : ''}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className='hint'>
          Máy bạn: <code>{detectPlatform({ userAgent: navigator.userAgent, platform: navigator.platform, maxTouchPoints: navigator.maxTouchPoints }).os}</code>
        </p>
      </section>
    </div>
  );
}
