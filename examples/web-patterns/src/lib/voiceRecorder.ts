/**
 * Ghi tin nhắn thoại + waveform (ý tưởng từ web.telegram.org: util/voiceRecording.ts, util/waveform.ts).
 *
 * - Ghi bằng MediaRecorder có sẵn của trình duyệt (Telegram dùng opus-recorder để ra file .ogg).
 * - Trong lúc ghi: AnalyserNode đo âm lượng mỗi frame để vẽ đồng hồ mức âm.
 * - Ghi ít nhất 1 giây: bấm dừng sớm thì hoãn lệnh stop cho đủ.
 * - Lúc dừng: tính waveform từ chính file âm thanh (giải mã lại), không phụ thuộc số frame đã vẽ.
 */

/** Ghi ngắn hơn mức này thì hoãn lệnh dừng (Telegram: MIN_RECORDING_TIME = 1000). */
export const MIN_RECORDING_MS = 1000;
/** Âm lượng dưới ngưỡng này coi như im lặng (Telegram: MIN_VOLUME = 0.1). */
export const MIN_VOLUME = 0.1;

export interface VoiceRecording {
  blob: Blob;
  mimeType: string;
  durationMs: number;
  /** waveform tính từ dữ liệu âm thanh, mỗi phần tử 0..1 */
  waveform: number[];
  /** mức âm lượng đã đo trong lúc ghi (mỗi frame một giá trị), giống mảng waveform của Telegram */
  liveLevels: number[];
}

export interface RecorderHandle {
  stop(): Promise<VoiceRecording>;
  cancel(): void;
}

/** Chọn định dạng đầu tiên trình duyệt hỗ trợ: Chrome/Firefox ra Opus, Safari ra AAC trong mp4. */
export function pickMimeType(): string {
  const candidates = ['audio/ogg;codecs=opus', 'audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'];
  if (typeof MediaRecorder === 'undefined') return '';
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? '';
}

/**
 * Mức âm lượng 0..1 của khung âm thanh hiện tại: căn bậc hai trung bình bình phương (RMS) của dạng sóng.
 * Telegram lấy trung bình getByteFrequencyData (độ lớn theo dB của 32 dải tần), cũng chạy được nhưng
 * một âm đơn tần chỉ rơi vào 1–2 dải nên trung bình rất thấp.
 */
export function readLevel(analyser: AnalyserNode, buffer: Float32Array<ArrayBuffer>) {
  analyser.getFloatTimeDomainData(buffer);
  let sum = 0;
  for (let i = 0; i < buffer.length; i++) sum += buffer[i] * buffer[i];
  // RMS của giọng nói thường dưới 0.3, nhân 3 cho dễ nhìn rồi chặn ở 1
  const level = Math.min(1, Math.sqrt(sum / buffer.length) * 3);
  return level < MIN_VOLUME ? 0 : level;
}

export function startRecording(
  stream: MediaStream,
  onLevel: (level: number) => void,
  { minDurationMs = MIN_RECORDING_MS }: { minDurationMs?: number } = {},
): RecorderHandle {
  const mimeType = pickMimeType();
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };

  // Analyser riêng cho đồng hồ mức âm, không ảnh hưởng tới file ghi
  const audioContext = new AudioContext();
  const source = audioContext.createMediaStreamSource(stream);
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 1024;
  source.connect(analyser);
  const buffer = new Float32Array(analyser.fftSize);
  const liveLevels: number[] = [];

  let frame = 0;
  const tick = () => {
    const level = readLevel(analyser, buffer);
    liveLevels.push(level);
    onLevel(level);
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);

  const startedAt = performance.now();
  recorder.start(250); // nhận dữ liệu mỗi 250ms, lỡ trình duyệt treo vẫn còn phần đã ghi

  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    cancelAnimationFrame(frame);
    source.disconnect();
    void audioContext.close();
  };

  return {
    stop: () =>
      new Promise<VoiceRecording>((resolve, reject) => {
        recorder.onerror = (event) => {
          release();
          reject((event as ErrorEvent).error ?? new Error('MediaRecorder error'));
        };
        recorder.onstop = async () => {
          const durationMs = performance.now() - startedAt;
          release();
          const type = recorder.mimeType || mimeType || 'audio/webm';
          const blob = new Blob(chunks, { type });
          const waveform = await waveformFromBlob(blob).catch(() => liveLevels);
          resolve({ blob, mimeType: type, durationMs, waveform, liveLevels });
        };
        // Bấm dừng ngay sau khi bấm ghi: đợi cho đủ thời lượng tối thiểu rồi mới dừng.
        // Bản ghi vài trăm mili giây gần như không dùng được (có lẽ đó là lý do Telegram đặt mức 1 giây).
        const wait = Math.max(0, startedAt + minDurationMs - performance.now());
        setTimeout(() => {
          if (recorder.state !== 'inactive') recorder.stop();
        }, wait);
      }),
    cancel: () => {
      recorder.onstop = null;
      if (recorder.state !== 'inactive') recorder.stop();
      release();
    },
  };
}

/**
 * Waveform từ chính file âm thanh: giải mã thành PCM rồi lấy đỉnh của từng đoạn.
 * Không phụ thuộc tốc độ khung hình (60 hay 120Hz) và không bị hụt khi tab bị ẩn
 * (requestAnimationFrame dừng hẳn ở tab ẩn, MediaRecorder thì vẫn ghi).
 */
export async function waveformFromBlob(blob: Blob, buckets = 200): Promise<number[]> {
  const context = new OfflineAudioContext(1, 1, 44100);
  const audio = await context.decodeAudioData(await blob.arrayBuffer());
  const data = audio.getChannelData(0);
  const size = Math.max(1, Math.floor(data.length / buckets));
  const result: number[] = [];
  for (let start = 0; start + size <= data.length; start += size) {
    let peak = 0;
    for (let i = start; i < start + size; i++) {
      const value = Math.abs(data[i]);
      if (value > peak) peak = value;
    }
    result.push(peak);
  }
  return result;
}
