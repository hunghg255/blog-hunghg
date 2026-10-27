import { useEffect, useMemo, useRef, useState } from 'react';
import { createAudioRegistry, createPosterForVideo, releaseMedia } from '../lib/tgAudioPlayer';
import { Log, Stat, useLog } from './shared';
import './TgAudioPlayerDemo.css';

/** Tạo "tin thoại" WAV: một âm sin ngắn, mỗi tin một cao độ. */
function makeVoice(freq: number, seconds: number) {
  const rate = 8000;
  const n = Math.round(rate * seconds);
  const buf = new ArrayBuffer(44 + n);
  const v = new DataView(buf);
  const w = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF');
  v.setUint32(4, 36 + n, true);
  w(8, 'WAVE');
  w(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate, true);
  v.setUint16(32, 1, true);
  v.setUint16(34, 8, true);
  w(36, 'data');
  v.setUint32(40, n, true);
  for (let i = 0; i < n; i++) {
    const env = Math.min(1, i / 400, (n - i) / 400);
    v.setUint8(44 + i, 128 + Math.round(40 * env * Math.sin((2 * Math.PI * freq * i) / rate)));
  }
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}

interface Voice {
  id: number;
  chat: string;
  from: string;
  seconds: number;
  freq: number;
}

const VOICES: Voice[] = [
  { id: 1, chat: 'Lan', from: 'Lan', seconds: 1.2, freq: 440 },
  { id: 2, chat: 'Lan', from: 'Lan', seconds: 1.0, freq: 523 },
  { id: 3, chat: 'Lan', from: 'Lan', seconds: 1.1, freq: 587 },
  { id: 4, chat: 'Lan', from: 'Lan', seconds: 0.9, freq: 659 },
  { id: 5, chat: 'Minh', from: 'Minh', seconds: 1.3, freq: 330 },
];

type Registry = ReturnType<typeof createAudioRegistry>;

export default function TgAudioPlayerDemo() {
  return (
    <div className='page tg-audio'>
      <h1>Telegram #19: trình phát audio toàn cục</h1>
      <Player />
      <ReleaseDemo />
      <PosterDemo />
    </div>
  );
}

function Player() {
  const [sorted, setSorted] = useState(true);
  const [chat, setChat] = useState('Lan');
  const [loadedOlder, setLoadedOlder] = useState(false);
  const [current, setCurrent] = useState<string>();
  const [, tick] = useState(0);
  const log = useLog(14);
  const urls = useMemo(() => new Map(VOICES.map((v) => [v.id, makeVoice(v.freq, v.seconds)])), []);
  const chatRef = useRef(chat);
  chatRef.current = chat;

  const registry = useMemo<Registry>(
    () =>
      createAudioRegistry({
        sortByOrder: sorted,
        onCurrentChange: (id) => setCurrent(id),
        onMissingNext: (id) => {
          // giống dispatch.openAudioPlayer: mở lại đúng chat chứa bài kế
          const voice = VOICES.find((v) => `voice-${v.id}` === id)!;
          log.add(`bài kế (${id}) đang ở chat khác → mở "${voice.chat}"`, 'warn');
          setChat(voice.chat);
          setPendingAutoplay(id);
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sorted],
  );
  const [pendingAutoplay, setPendingAutoplay] = useState<string>();

  useEffect(() => {
    setLoadedOlder(false);
    setChat('Lan');
    return () => registry.pauseCurrent();
  }, [registry]);

  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 200);
    return () => clearInterval(id);
  }, []);

  // Lúc đầu chat chỉ tải 2 tin mới nhất; "tải tin cũ" mount thêm 2 tin cũ SAU
  const visible = VOICES.filter((v) => v.chat === chat && (chat !== 'Lan' || loadedOlder || v.id >= 3));
  const now = registry.current();

  return (
    <>
      <p className='hint'>
        Mở chat Lan (mới tải 2 tin cuối), bấm <b>Tải tin cũ hơn</b>, rồi phát tin #2. Hết tin #2, trình phát phải chuyển
        sang #3. Với danh sách theo thứ tự mount như bản gốc, #2 bị xếp cuối hàng nên dừng luôn. Đang phát mà chuyển sang
        chat Minh thì tiếng vẫn chạy và thanh player trên cùng vẫn hiện.
      </p>
      <div className='toolbar'>
        <button className={sorted ? '' : 'primary'} onClick={() => setSorted(false)}>
          Thứ tự mount (bản gốc)
        </button>
        <button className={sorted ? 'primary' : ''} onClick={() => setSorted(true)}>
          Thứ tự tin
        </button>
      </div>
      <div className='tga-bar' aria-live='polite'>
        {current && now ? (
          <>
            <span>🎙 {current}</span>
            <progress max={now.duration || 1} value={now.currentTime} />
            <span>{now.paused ? 'tạm dừng' : 'đang phát'}</span>
            <button onClick={() => registry.pauseCurrent()}>⏸</button>
          </>
        ) : (
          <span className='muted'>Không có gì đang phát</span>
        )}
      </div>
      <div className='stats'>
        <Stat label='danh sách phát' value={registry.queue.map((q) => q.replace('voice-', '#')).join(' → ') || '—'} />
      </div>
      <div className='card tga-chat'>
        <div className='toolbar' role='tablist'>
          {['Lan', 'Minh'].map((c) => (
            <button key={c} role='tab' aria-selected={c === chat} className={c === chat ? 'primary' : ''} onClick={() => setChat(c)}>
              {c}
            </button>
          ))}
          {chat === 'Lan' && !loadedOlder && <button onClick={() => setLoadedOlder(true)}>↑ Tải tin cũ hơn</button>}
        </div>
        {visible.map((v) => (
          <VoiceMessage
            key={`${sorted}-${v.id}`}
            voice={v}
            src={urls.get(v.id)!}
            registry={registry}
            autoplay={pendingAutoplay === `voice-${v.id}`}
            onAutoplayed={() => setPendingAutoplay(undefined)}
            log={log.add}
          />
        ))}
      </div>
      <Log lines={log.lines} />
    </>
  );
}

function VoiceMessage({
  voice,
  src,
  registry,
  autoplay,
  onAutoplayed,
  log,
}: {
  voice: Voice;
  src: string;
  registry: Registry;
  autoplay: boolean;
  onAutoplayed(): void;
  log(text: string, tone?: 'ok' | 'warn' | 'err' | 'muted'): void;
}) {
  const id = `voice-${voice.id}`;
  const [state, setState] = useState({ playing: false, time: 0, duration: voice.seconds });
  const controller = useRef<ReturnType<Registry['register']> | undefined>(undefined);

  useEffect(() => {
    const c = registry.register(
      id,
      (event, media) => {
        setState({ playing: !media.paused, time: media.currentTime, duration: media.duration || voice.seconds });
        if (event === 'ended') log(`#${voice.id} hết`, 'muted');
      },
      { order: voice.id, onForcePlay: () => c.play(src) },
    );
    controller.current = c;
    return () => c.destroy();
  }, [id, registry, src, voice, log]);

  useEffect(() => {
    if (autoplay) {
      controller.current?.play(src);
      onAutoplayed();
    }
  }, [autoplay, onAutoplayed, src]);

  return (
    <div className='tga-voice'>
      <button
        className='tga-play'
        aria-label={state.playing ? `Tạm dừng tin ${voice.id}` : `Phát tin ${voice.id}`}
        onClick={() => {
          if (state.playing) controller.current?.pause();
          else {
            log(`phát #${voice.id}`, 'ok');
            controller.current?.play(src);
          }
        }}
      >
        {state.playing ? '⏸' : '▶'}
      </button>
      <div className='tga-wave'>
        <div style={{ width: `${Math.min(100, (state.time / state.duration) * 100)}%` }} />
      </div>
      <span className='tga-meta'>
        #{voice.id} · {voice.seconds.toFixed(1)}s
      </span>
    </div>
  );
}

// ---------- Nhả bộ nhớ ----------

function ReleaseDemo() {
  const [result, setResult] = useState<Record<string, string>>({});
  const url = useMemo(() => makeVoice(300, 0.5), []);

  const run = async (name: string, release: (m: HTMLMediaElement) => void) => {
    const media = new Audio();
    let errors = 0;
    media.addEventListener('error', () => errors++);
    media.src = url;
    await new Promise((r) => media.addEventListener('loadeddata', r, { once: true }));
    release(media);
    await new Promise((r) => setTimeout(r, 300));
    setResult((prev) => ({ ...prev, [name]: `${errors} sự kiện error, networkState=${media.networkState}` }));
  };

  return (
    <>
      <h2>Nhả bộ nhớ khi bỏ thẻ media</h2>
      <p className='hint'>
        Cả hai cách đều làm trình duyệt bỏ dữ liệu đã tải. Khác ở chỗ <code>src = &apos;&apos;</code> còn bắn một sự kiện{' '}
        <code>error</code>, nên listener báo lỗi nào còn gắn sẽ báo một lỗi không có thật.
      </p>
      <div className='toolbar'>
        <button
          onClick={() =>
            run('srcEmpty', (m) => {
              m.pause();
              m.src = '';
              m.load();
            })
          }
        >
          src = &apos;&apos; (bản gốc)
        </button>
        <button onClick={() => run('remove', releaseMedia)}>removeAttribute(&apos;src&apos;)</button>
      </div>
      <div className='stats'>
        <Stat label="src = ''" value={result.srcEmpty ?? '—'} />
        <Stat label='removeAttribute' value={result.remove ?? '—'} />
      </div>
    </>
  );
}

// ---------- Poster ----------

async function recordSampleVideo(): Promise<string> {
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 180;
  const ctx = canvas.getContext('2d')!;
  const stream = canvas.captureStream(30);
  const recorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => chunks.push(e.data);
  const start = performance.now();
  let raf = 0;
  const draw = () => {
    const t = (performance.now() - start) / 1000;
    ctx.fillStyle = `hsl(${t * 120} 60% 45%)`;
    ctx.fillRect(0, 0, 320, 180);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 48px system-ui, sans-serif';
    ctx.fillText(`${t.toFixed(1)}s`, 100, 110);
    raf = requestAnimationFrame(draw);
  };
  draw();
  recorder.start(100);
  await new Promise((r) => setTimeout(r, 1800));
  recorder.stop();
  cancelAnimationFrame(raf);
  await new Promise((r) => (recorder.onstop = r));
  return URL.createObjectURL(new Blob(chunks, { type: 'video/webm' }));
}

function PosterDemo() {
  const [video, setVideo] = useState<string>();
  const [poster, setPoster] = useState<string | null>();
  const [status, setStatus] = useState('');

  const make = async (url: string) => {
    setStatus('Đang lấy khung…');
    const t0 = performance.now();
    try {
      const result = await createPosterForVideo(url);
      setPoster(result ?? null);
      setStatus(result ? `Xong sau ${Math.round(performance.now() - t0)}ms` : 'Không có hình (file chỉ có tiếng, hoặc hết hạn 2s)');
    } catch (e) {
      setStatus(`Lỗi: ${(e as Error).message}`);
    }
  };

  return (
    <>
      <h2>Lấy poster video ngay ở client</h2>
      <p className='hint'>Trước khi upload, Telegram tua video tới giây thứ 1 và vẽ khung đó lên canvas làm ảnh xem trước.</p>
      <div className='toolbar'>
        <button
          onClick={async () => {
            setStatus('Đang quay video mẫu 1,8s…');
            const url = await recordSampleVideo();
            setVideo(url);
            await make(url);
          }}
        >
          Tạo video mẫu + poster
        </button>
        <button onClick={() => make(makeVoice(440, 0.6))}>Thử với file chỉ có tiếng</button>
        <label className='tga-file'>
          Chọn video…
          <input
            type='file'
            accept='video/*'
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              const url = URL.createObjectURL(f);
              setVideo(url);
              void make(url);
            }}
          />
        </label>
      </div>
      <p className='hint'>{status}</p>
      <div className='split'>
        <div className='card'>{video ? <video src={video} controls muted className='tga-media' /> : <span className='muted'>Video</span>}</div>
        <div className='card'>
          {poster ? <img src={poster} alt='Poster lấy từ giây thứ 1' className='tga-media' /> : <span className='muted'>{poster === null ? '(không có poster)' : 'Poster'}</span>}
        </div>
      </div>
    </>
  );
}
