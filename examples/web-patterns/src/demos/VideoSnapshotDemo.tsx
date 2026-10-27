import { useEffect, useRef, useState } from 'react';
import { TaintedCanvasError, captureVideoFrame, dataUrlToBlob } from '../lib/videoSnapshot';
import { Log, useLog } from './shared';
import './VideoSnapshotDemo.css';

type Aspect = '16:9' | '4:3';
const SIZES: Record<Aspect, [number, number]> = { '16:9': [640, 360], '4:3': [480, 360] };

/** "Video" tự tạo: vẽ canvas mỗi frame rồi captureStream, khỏi tải file ngoài. Hình tròn bị méo = ảnh bị kéo giãn. */
function useGeneratedVideo(aspect: Aspect) {
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const [w, h] = SIZES[aspect];
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    let frame = 0;
    let id = 0;
    const draw = () => {
      frame++;
      const gradient = ctx.createLinearGradient(0, 0, w, h);
      gradient.addColorStop(0, '#1e3a8a');
      gradient.addColorStop(1, '#7c3aed');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = 2;
      for (let x = 60; x < w; x += 120) {
        for (let y = 60; y < h; y += 120) {
          ctx.beginPath();
          ctx.arc(x, y, 40, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      ctx.fillStyle = '#fbbf24';
      ctx.beginPath();
      ctx.arc(w / 2 + Math.cos(frame / 20) * (w / 3), h / 2 + Math.sin(frame / 15) * (h / 4), 24, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 28px system-ui, sans-serif';
      ctx.fillText(`${aspect}  frame ${frame}`, 16, h - 18);
      id = requestAnimationFrame(draw);
    };
    draw();
    const stream = canvas.captureStream(30);
    const video = videoRef.current!;
    video.srcObject = stream;
    void video.play().catch(() => {});
    return () => {
      cancelAnimationFrame(id);
      stream.getTracks().forEach((t) => t.stop());
      video.srcObject = null;
    };
  }, [aspect]);
  return videoRef;
}

/** Bản gốc Coursera (viết lại cho demo): khung cố định 960×540, toDataURL JPEG, rồi đổi base64 về Blob. */
function snapshotLikeCoursera(video: HTMLVideoElement) {
  const canvas = document.createElement('canvas');
  canvas.width = 960;
  canvas.height = 540;
  canvas.getContext('2d')!.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg');
}

/** Đọc 2 byte đầu để biết file thật là JPEG (FF D8) hay PNG (89 50). */
async function sniff(blob: Blob) {
  const [a, b] = new Uint8Array(await blob.slice(0, 2).arrayBuffer());
  if (a === 0xff && b === 0xd8) return 'JPEG';
  if (a === 0x89 && b === 0x50) return 'PNG';
  return 'khác';
}

interface Shot {
  label: string;
  url: string;
  width: number;
  height: number;
  bytes: number;
  extra: string;
  ok: boolean;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

const DEFAULT_REMOTE = 'https://raw.githubusercontent.com/hunghg255/blog-hunghg/master/public/blogs/web-series.png';

export default function VideoSnapshotDemo() {
  const [aspect, setAspect] = useState<Aspect>('4:3');
  const videoRef = useGeneratedVideo(aspect);
  const [shots, setShots] = useState<Shot[]>([]);
  const [remote, setRemote] = useState(DEFAULT_REMOTE);
  const { lines, add } = useLog();

  const urlsRef = useRef(new Set<string>());
  useEffect(() => () => urlsRef.current.forEach((url) => URL.revokeObjectURL(url)), []);
  /** Thêm ảnh mới lên đầu, giữ tối đa 4 ảnh, thu hồi object URL của ảnh bị bỏ. */
  const pushShot = (shot: Shot) =>
    setShots((prev) => {
      urlsRef.current.add(shot.url);
      const next = [shot, ...prev];
      next.slice(4).forEach((old) => {
        URL.revokeObjectURL(old.url);
        urlsRef.current.delete(old.url);
      });
      return next.slice(0, 4);
    });

  async function coursera() {
    const video = videoRef.current!;
    const t0 = performance.now();
    const dataUrl = snapshotLikeCoursera(video);
    const blob = dataUrlToBlob(dataUrl);
    const ms = performance.now() - t0;
    const kind = await sniff(blob);
    const img = await loadImage(dataUrl);
    pushShot({
        label: 'Kiểu Coursera',
        url: URL.createObjectURL(blob),
        width: img.width,
        height: img.height,
        bytes: blob.size,
        extra: `data URL ${(dataUrl.length / 1024).toFixed(0)}KB ký tự (base64 +33%), chặn main thread ${ms.toFixed(1)}ms; upload khai báo image/png nhưng file là ${kind}`,
        ok: false,
    });
    add(`Coursera: 960×540 từ nguồn ${video.videoWidth}×${video.videoHeight}`, aspect === '4:3' ? 'warn' : undefined);
  }

  async function fitted() {
    const video = videoRef.current!;
    const t0 = performance.now();
    const blob = await captureVideoFrame(video, { maxWidth: 960 });
    const ms = performance.now() - t0;
    const url = URL.createObjectURL(blob);
    const img = await loadImage(url);
    pushShot({
        label: 'Giữ tỉ lệ + toBlob',
        url,
        width: img.width,
        height: img.height,
        bytes: blob.size,
        extra: `toBlob bất đồng bộ (${ms.toFixed(1)}ms tính cả mã hoá), file ${await sniff(blob)}`,
        ok: true,
    });
    add(`Giữ tỉ lệ: ${img.width}×${img.height} từ nguồn ${video.videoWidth}×${video.videoHeight}`, 'ok');
  }

  async function tryRemote(crossOrigin: boolean) {
    const img = new Image();
    if (crossOrigin) img.crossOrigin = 'anonymous';
    // thêm query để trình duyệt không dùng lại bản cache tải KHÔNG có CORS ở lần trước
    img.src = `${remote}${remote.includes('?') ? '&' : '?'}${crossOrigin ? 'cors' : 'plain'}=${Date.now()}`;
    try {
      await img.decode();
    } catch {
      add(`Không tải được ảnh${crossOrigin ? ' với crossOrigin (server không gửi CORS?)' : ''}`, 'err');
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    canvas.getContext('2d')!.drawImage(img, 0, 0);
    try {
      const blob = await new Promise<Blob>((resolve, reject) => {
        try {
          canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('null'))), 'image/jpeg', 0.8);
        } catch (error) {
          reject(error);
        }
      });
      add(`crossOrigin=${crossOrigin ? '"anonymous"' : '(không có)'}: đọc được ${(blob.size / 1024).toFixed(0)}KB`, 'ok');
    } catch (error) {
      const tainted = error instanceof DOMException && error.name === 'SecurityError';
      add(
        `crossOrigin=${crossOrigin ? '"anonymous"' : '(không có)'}: ${tainted ? new TaintedCanvasError().message : String(error)}`,
        'err',
      );
    }
  }

  return (
    <div className='page vs'>
      <h1>Chụp frame video thành ảnh</h1>
      <p className='hint'>
        Video bên dưới được vẽ bằng canvas rồi phát qua <code>captureStream()</code>. Chọn tỉ lệ 4:3 rồi chụp kiểu Coursera: khung
        cố định 960×540 làm vòng tròn thành hình bầu dục.
      </p>

      <div className='toolbar'>
        {(['16:9', '4:3'] as const).map((value) => (
          <button key={value} className={aspect === value ? 'primary' : ''} onClick={() => setAspect(value)}>
            Video {value}
          </button>
        ))}
        <button onClick={coursera}>📸 Chụp kiểu Coursera</button>
        <button className='primary' onClick={fitted}>
          📸 Chụp giữ tỉ lệ
        </button>
      </div>

      <video ref={videoRef} className='vs-video' muted playsInline aria-label='Video nguồn' />

      <div className='vs-shots'>
        {shots.map((shot) => (
          <figure key={shot.url} className='card'>
            <img src={shot.url} alt={shot.label} />
            <figcaption>
              <b className={shot.ok ? 'ok' : 'warn'}>{shot.label}</b>: {shot.width}×{shot.height}, {(shot.bytes / 1024).toFixed(0)}KB
              <br />
              <small>{shot.extra}</small>
            </figcaption>
          </figure>
        ))}
      </div>

      <section className='card vs-remote'>
        <h2>Ảnh từ origin khác</h2>
        <p className='muted'>
          Vẽ ảnh khác origin lên canvas thì canvas bị "taint": vẫn hiển thị được nhưng không đọc ra được nữa. Cần cả{' '}
          <code>crossOrigin="anonymous"</code> lẫn header CORS của server. Cần mạng.
        </p>
        <input type='text' value={remote} onChange={(e) => setRemote(e.target.value)} aria-label='URL ảnh' />
        <div className='toolbar'>
          <button onClick={() => tryRemote(false)}>Vẽ không có crossOrigin</button>
          <button onClick={() => tryRemote(true)}>Vẽ với crossOrigin="anonymous"</button>
        </div>
      </section>

      <Log lines={lines} />
    </div>
  );
}
