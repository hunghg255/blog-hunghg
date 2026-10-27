/**
 * Waveform của tin nhắn thoại: thu nhỏ, đóng gói 5 bit, giải nén (ý tưởng từ web.telegram.org: util/waveform.ts,
 * vốn chép từ Telegram Desktop). Telegram lưu 100 mức âm lượng, mỗi mức 0..31 (5 bit), tổng cộng 63 byte.
 */

/** Số mức trong waveform gửi lên server. */
export const WAVEFORM_VALUES = 100;
/** 100 giá trị × 5 bit = 500 bit, làm tròn lên 63 byte. */
export const WAVEFORM_BYTES = Math.ceil((WAVEFORM_VALUES * 5) / 8);

/**
 * Thu nhỏ (hoặc kéo giãn) mảng về đúng `count` phần tử bằng cách lấy ĐỈNH của từng đoạn.
 * Một tiếng "tách" ngắn vẫn còn sau khi thu nhỏ.
 */
export function resampleByPeak(data: number[], count: number): number[] {
  if (data.length === 0) return new Array(count).fill(0);
  const result: number[] = [];
  for (let i = 0; i < count; i++) {
    const start = Math.floor((i * data.length) / count);
    // khi dữ liệu ít hơn số cột, end có thể bằng start: lấy ít nhất 1 phần tử
    const end = Math.max(start + 1, Math.floor(((i + 1) * data.length) / count));
    let peak = 0;
    for (let j = start; j < end; j++) peak = Math.max(peak, data[j]);
    result.push(peak);
  }
  return result;
}

/**
 * Cách Telegram (interpolateArray): mỗi cột chỉ lấy trung bình 3 phần tử quanh một chỉ số mẫu.
 * Khi thu nhỏ mạnh (vd 600 → 63) phần lớn dữ liệu bị bỏ qua, đỉnh ngắn có thể biến mất.
 */
export function resampleLikeTelegram(data: number[], count: number): number[] {
  const step = data.length / count;
  const left = data[0];
  const right = data[data.length - 1];
  const result: number[] = [];
  for (let i = 0; i < count; i++) {
    const idx = Math.floor(i * step);
    result.push(((data[idx - 1] ?? left) + (data[idx] ?? left) + (data[idx + 1] ?? right)) / 3);
  }
  return result;
}

/** Quy mảng 0..1 về số nguyên 0..31, chia theo đỉnh để bản ghi nói nhỏ vẫn có waveform rõ. */
export function toLevels(data: number[]): number[] {
  const peak = Math.max(...data, 1e-6);
  return data.map((value) => Math.round((value / peak) * 31));
}

/** Đóng gói các giá trị 0..31 thành chuỗi bit 5 bit/giá trị (bit thấp trước). */
export function encodeWaveform(levels: number[]): Uint8Array {
  const bytes = new Uint8Array(Math.ceil((levels.length * 5) / 8));
  levels.forEach((level, i) => {
    const bit = i * 5;
    const byteIndex = bit >> 3;
    const shifted = (level & 0x1f) << (bit & 7);
    // 5 bit có thể vắt qua 2 byte: ghi phần thấp vào byte này, phần cao vào byte sau
    bytes[byteIndex] |= shifted & 0xff;
    if (byteIndex + 1 < bytes.length) bytes[byteIndex + 1] |= shifted >> 8;
  });
  return bytes;
}

/** Giải nén: đọc 16 bit bắt đầu từ byte chứa giá trị, dịch rồi lấy 5 bit (như decodeWaveform của Telegram). */
export function decodeWaveform(bytes: Uint8Array): number[] {
  const count = Math.floor((bytes.length * 8) / 5);
  const result: number[] = [];
  for (let i = 0; i < count; i++) {
    const bit = i * 5;
    const byteIndex = bit >> 3;
    // byte cuối không có byte kế tiếp: coi như 0 thay vì đọc ra ngoài mảng
    const word = bytes[byteIndex] | ((bytes[byteIndex + 1] ?? 0) << 8);
    result.push((word >> (bit & 7)) & 0x1f);
  }
  return result;
}

export interface DrawOptions {
  progress?: number;
  color: string;
  progressColor: string;
  barWidth?: number;
  gap?: number;
}

/** Vẽ waveform dạng cột bo tròn lên canvas, phần đã phát tô màu khác. Giá trị đầu vào 0..31. */
export function drawWaveform(canvas: HTMLCanvasElement, levels: number[], options: DrawOptions) {
  const { progress = 0, color, progressColor, barWidth = 2, gap = 2 } = options;
  const dpr = window.devicePixelRatio || 1;
  const width = levels.length * (barWidth + gap);
  const height = canvas.clientHeight || 32;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.width = `${width}px`;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(dpr, dpr);
  levels.forEach((level, i) => {
    const barHeight = Math.max(2, (height * level) / 31);
    ctx.fillStyle = i / levels.length < progress ? progressColor : color;
    ctx.beginPath();
    ctx.roundRect(i * (barWidth + gap), height - barHeight, barWidth, barHeight, barWidth / 2);
    ctx.fill();
  });
}
