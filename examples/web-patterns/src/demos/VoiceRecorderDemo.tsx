import { useEffect, useRef, useState } from 'react';
import { MIN_RECORDING_MS, startRecording, type RecorderHandle, type VoiceRecording } from '../lib/voiceRecorder';
import {
  WAVEFORM_VALUES,
  decodeWaveform,
  drawWaveform,
  encodeWaveform,
  resampleByPeak,
  resampleLikeTelegram,
  toLevels,
} from '../lib/voiceRecorderWaveform';
import { Log, Stat, useLog } from './shared';
import './VoiceRecorderDemo.css';

/**
 * Nguồn âm giả lập khi không có micro: tiếng ồn lọc dải 300–3000Hz (gần giọng nói) bật/tắt theo "âm tiết",
 * xen vài tiếng "tách" rất ngắn để thấy đỉnh ngắn có còn sau khi thu nhỏ waveform hay không.
 */
function createFakeVoice() {
  const ctx = new AudioContext();
  const noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const samples = noise.getChannelData(0);
  for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
  const source = ctx.createBufferSource();
  source.buffer = noise;
  source.loop = true;
  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = 900;
  band.Q.value = 0.6;
  const gain = ctx.createGain();
  gain.gain.value = 0;
  const destination = ctx.createMediaStreamDestination();
  source.connect(band).connect(gain).connect(destination);

  // lịch âm lượng 20 giây: âm tiết 120–400ms, nghỉ 60–250ms, cứ khoảng 1.5s chèn một tiếng "tách" 15ms
  let t = ctx.currentTime + 0.05;
  const end = t + 20;
  let nextClick = t + 0.7;
  while (t < end) {
    if (t >= nextClick) {
      gain.gain.setValueAtTime(1, t);
      gain.gain.setValueAtTime(0, t + 0.015);
      t += 0.2;
      nextClick = t + 1.2 + Math.random() * 0.6;
      continue;
    }
    const syllable = 0.12 + Math.random() * 0.28;
    const loud = 0.3 + Math.random() * 0.35;
    gain.gain.setTargetAtTime(loud, t, 0.02);
    gain.gain.setTargetAtTime(0, t + syllable, 0.03);
    t += syllable + 0.06 + Math.random() * 0.19;
  }
  source.start();
  let stopped = false;
  return {
    stream: destination.stream,
    stop: () => {
      if (stopped) return;
      stopped = true;
      source.stop();
      void ctx.close();
    },
  };
}

function useCssColor(name: string) {
  const [color, setColor] = useState('#888');
  useEffect(() => {
    setColor(getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888');
  }, [name]);
  return color;
}

function Waveform({ levels, progress = 0, onSeek, label }: { levels: number[]; progress?: number; onSeek?: (ratio: number) => void; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const muted = useCssColor('--muted');
  const accent = useCssColor('--accent');
  useEffect(() => {
    if (ref.current) drawWaveform(ref.current, levels, { progress, color: muted, progressColor: accent });
  }, [levels, progress, muted, accent]);
  return (
    <canvas
      ref={ref}
      className='vr-wave'
      role='img'
      aria-label={label}
      onClick={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        onSeek?.((e.clientX - rect.left) / rect.width);
      }}
    />
  );
}

const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(' ');

export default function VoiceRecorderDemo() {
  const { lines, add } = useLog();
  const [state, setState] = useState<'idle' | 'recording' | 'stopping'>('idle');
  const [level, setLevel] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState<VoiceRecording | null>(null);
  const [audioUrl, setAudioUrl] = useState('');
  const [progress, setProgress] = useState(0);
  const handleRef = useRef<RecorderHandle | null>(null);
  const stopSourceRef = useRef<(() => void) | null>(null);
  const startedRef = useRef(0);
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    if (state !== 'recording') return;
    const id = setInterval(() => setElapsed(performance.now() - startedRef.current), 100);
    return () => clearInterval(id);
  }, [state]);

  useEffect(() => () => URL.revokeObjectURL(audioUrl), [audioUrl]);
  useEffect(
    () => () => {
      handleRef.current?.cancel();
      stopSourceRef.current?.();
    },
    [],
  );

  async function start(kind: 'mic' | 'fake') {
    let stream: MediaStream;
    try {
      if (kind === 'mic') {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stopSourceRef.current = () => stream.getTracks().forEach((track) => track.stop());
      } else {
        const fake = createFakeVoice();
        stream = fake.stream;
        stopSourceRef.current = fake.stop;
      }
    } catch (error) {
      add(`Không mở được micro (${(error as Error).name}). Dùng "Ghi giả lập".`, 'err');
      return;
    }
    handleRef.current = startRecording(stream, setLevel);
    startedRef.current = performance.now();
    setElapsed(0);
    setResult(null);
    setState('recording');
    add(kind === 'mic' ? 'Bắt đầu ghi từ micro' : 'Bắt đầu ghi nguồn giả lập', 'muted');
  }

  async function stop() {
    const handle = handleRef.current;
    if (!handle) return;
    const asked = performance.now() - startedRef.current;
    if (asked < MIN_RECORDING_MS) add(`Bấm dừng sau ${Math.round(asked)}ms: hoãn tới đủ ${MIN_RECORDING_MS}ms`, 'warn');
    setState('stopping');
    const recording = await handle.stop();
    stopSourceRef.current?.();
    handleRef.current = null;
    setLevel(0);
    setResult(recording);
    setAudioUrl(URL.createObjectURL(recording.blob));
    setProgress(0);
    setState('idle');
    add(
      `Xong: ${(recording.durationMs / 1000).toFixed(1)}s, ${(recording.blob.size / 1024).toFixed(1)}KB, ${recording.mimeType}`,
      'ok',
    );
  }

  const levels = result ? toLevels(resampleByPeak(result.waveform, WAVEFORM_VALUES)) : [];
  const packed = encodeWaveform(levels);
  const roundTrip = decodeWaveform(packed);
  // Telegram Web (theo bản dump): resample về 63 giá trị 0..255 rồi gửi thẳng, không đóng gói 5 bit
  const rawBytes = result
    ? Uint8Array.from(resampleLikeTelegram(result.liveLevels.map((v) => v * 255), packed.length))
    : new Uint8Array();
  const misread = decodeWaveform(rawBytes);
  // thu nhỏ waveform gốc (0..1) còn 40 cột, rồi quy về 0..31 theo CÙNG một đỉnh (đỉnh của bản ghi) để so sánh công bằng
  const source = result?.waveform ?? [];
  const sourcePeak = Math.max(...source, 1e-6);
  const scale = (values: number[]) => values.map((v) => Math.round((v / sourcePeak) * 31));
  const byPeak = scale(resampleByPeak(source, 40));
  const byTelegram = scale(resampleLikeTelegram(source, 40));
  const keptPeak = (values: number[]) => `${Math.round((Math.max(...values) / 31) * 100)}%`;

  return (
    <div className='page vr'>
      <h1>Tin nhắn thoại: ghi âm và waveform</h1>
      <p className='hint'>
        Ghi bằng micro thật hoặc nguồn giả lập (tiếng ồn lọc dải giống giọng nói, xen vài tiếng "tách" rất ngắn). Thử bấm dừng
        ngay sau khi bấm ghi: bản ghi vẫn dài ít nhất 1 giây.
      </p>

      <div className='toolbar'>
        <button className='primary' onClick={() => start('fake')} disabled={state !== 'idle'}>
          🔊 Ghi giả lập
        </button>
        <button onClick={() => start('mic')} disabled={state !== 'idle'}>
          🎙 Ghi bằng micro
        </button>
        <button onClick={stop} disabled={state !== 'recording'}>
          ■ Dừng
        </button>
        <span className='vr-meter' aria-label='Mức âm lượng'>
          <span style={{ transform: `scaleX(${level})` }} />
        </span>
        <span className='muted'>{state === 'idle' ? '' : `${(elapsed / 1000).toFixed(1)}s`}</span>
      </div>

      {result && (
        <>
          <div className='stats'>
            <Stat label='thời lượng' value={`${(result.durationMs / 1000).toFixed(1)}s`} />
            <Stat label='kích thước' value={`${(result.blob.size / 1024).toFixed(1)}KB`} />
            <Stat label='mẫu đo trong lúc ghi' value={result.liveLevels.length} />
            <Stat label='byte waveform gửi đi' value={packed.length} />
          </div>

          <section className='card'>
            <h2>Nghe lại</h2>
            <div className='vr-player'>
              <audio
                ref={audioRef}
                src={audioUrl}
                controls
                onTimeUpdate={(e) => {
                  const a = e.currentTarget;
                  setProgress(Number.isFinite(a.duration) && a.duration > 0 ? a.currentTime / a.duration : 0);
                }}
              />
              <Waveform
                levels={levels}
                progress={progress}
                label='Waveform 100 mức'
                onSeek={(ratio) => {
                  const a = audioRef.current;
                  if (a && Number.isFinite(a.duration)) a.currentTime = ratio * a.duration;
                }}
              />
            </div>
          </section>

          <section className='card'>
            <h2>Gửi waveform qua mạng: 100 mức × 5 bit = {packed.length} byte</h2>
            <code className='vr-hex'>{hex(packed)}</code>
            <div className='vr-compare'>
              <div>
                <b className='ok'>Đóng gói 5 bit rồi giải nén</b>
                <Waveform levels={roundTrip} label='Waveform sau khi đóng gói và giải nén' />
                <small>{roundTrip.every((v, i) => v === levels[i]) ? 'giống hệt bản gốc' : 'khác bản gốc'}</small>
              </div>
              <div>
                <b className='err'>Gửi thẳng 63 mức 0..255 (kiểu Telegram Web)</b>
                <Waveform levels={misread} label='Waveform bị đọc sai' />
                <small>bên nhận vẫn đọc 5 bit một: hình bị xáo trộn</small>
              </div>
            </div>
          </section>

          <section className='card'>
            <h2>Thu nhỏ còn 40 cột</h2>
            <div className='vr-compare'>
              <div>
                <b className='ok'>Lấy đỉnh từng đoạn</b>
                <Waveform levels={byPeak} label='Thu nhỏ bằng đỉnh' />
                <small>cột cao nhất bằng {keptPeak(byPeak)} đỉnh của bản ghi</small>
              </div>
              <div>
                <b className='warn'>Trung bình 3 điểm quanh mẫu (Telegram)</b>
                <Waveform levels={byTelegram} label='Thu nhỏ kiểu Telegram' />
                <small>cột cao nhất chỉ bằng {keptPeak(byTelegram)} đỉnh: tiếng "tách" ngắn bị san phẳng hoặc bỏ qua</small>
              </div>
            </div>
          </section>
        </>
      )}

      <Log lines={lines} />
    </div>
  );
}
