/**
 * Vạch chia cho thước thời gian (timeline/waveform) có zoom.
 *
 * Ý tưởng từ anchor.fm (Waveform/helpers): chọn bước vạch theo `pxPerSec` (số pixel cho
 * 1 giây ở mức zoom hiện tại). Anchor dùng một bậc thang if/else viết tay; bản này tính
 * từ một danh sách "bước đẹp" và khoảng cách tối thiểu tính bằng pixel, nên đổi ngưỡng
 * hay thêm bước không phải sửa cả bậc thang.
 */

/** Các bước "đẹp" (giây) mà người đọc quen: 0.01s, 0.05s, 1s, 5s, 15s, 1 phút, 5 phút… */
export const NICE_STEPS = [
  0.01, 0.02, 0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600,
];

export interface TickOptions {
  /** khoảng cách tối thiểu giữa 2 vạch nhỏ, px */
  minTickPx?: number;
  /** khoảng cách tối thiểu giữa 2 nhãn, px (đủ chỗ cho chữ "00:00.00") */
  minLabelPx?: number;
}

export interface TickScale {
  /** bước vạch nhỏ, giây */
  step: number;
  /** bước vạch có nhãn, giây (luôn là bội số của step) */
  labelStep: number;
  /** số chữ số thập phân cần để nhãn không trùng nhau */
  decimals: number;
}

/** Số chữ số thập phân của một bước, vd 0.25 -> 2, 0.1 -> 1, 5 -> 0. */
function decimalsOf(value: number) {
  for (let d = 0; d < 4; d++) {
    if (Math.abs(Math.round(value * 10 ** d) - value * 10 ** d) < 1e-9) return d;
  }
  return 3;
}

/** Bước sau là bội số nguyên của bước trước? (0.25 -> 0.5 có, 0.25 -> 1 có, 0.2 -> 0.5 không) */
function isMultiple(big: number, small: number) {
  const ratio = big / small;
  return Math.abs(ratio - Math.round(ratio)) < 1e-9;
}

export function chooseTickScale(
  pxPerSec: number,
  { minTickPx = 8, minLabelPx = 70 }: TickOptions = {},
): TickScale {
  // vạch nhỏ: bước nhỏ nhất mà 2 vạch vẫn cách nhau >= minTickPx
  const step = NICE_STEPS.find((s) => s * pxPerSec >= minTickPx) ?? NICE_STEPS[NICE_STEPS.length - 1];
  // nhãn: bước nhỏ nhất >= minLabelPx VÀ là bội số của step, để nhãn luôn nằm đúng trên vạch
  const labelStep =
    NICE_STEPS.find((s) => s >= step && s * pxPerSec >= minLabelPx && isMultiple(s, step)) ??
    // zoom ra cực xa: nhân bước lớn nhất lên cho tới khi đủ chỗ
    step * Math.ceil(minLabelPx / (step * pxPerSec));
  return { step, labelStep, decimals: decimalsOf(labelStep) };
}

/** mm:ss hoặc mm:ss.ff, phút có thể > 59 (podcast dài vài giờ vẫn đọc được). */
export function formatTime(seconds: number, decimals = 0) {
  // làm tròn trước khi tách phút/giây, để 59.999s ra "01:00" chứ không phải "00:60"
  const factor = 10 ** decimals;
  const total = Math.round(seconds * factor) / factor;
  const minutes = Math.floor(total / 60);
  const rest = total - minutes * 60;
  const [whole, frac] = rest.toFixed(decimals).split('.');
  const secondsStr = whole.padStart(2, '0') + (frac ? `.${frac}` : '');
  return `${String(minutes).padStart(2, '0')}:${secondsStr}`;
}

export interface Tick {
  time: number;
  x: number;
  label?: string;
}

/**
 * Các vạch nằm trong đoạn [startSec, endSec] đang hiển thị.
 * Tính `i * step` từ chỉ số nguyên thay vì cộng dồn `t += step`: cộng dồn 0.1 nhiều lần thì
 * sai số tích tụ và nhãn lệch khỏi vạch. Một phép nhân vẫn có sai số nhỏ (3 * 0.1 =
 * 0.30000000000000004) nên làm tròn tới micro giây.
 */
export function buildTicks(startSec: number, endSec: number, pxPerSec: number, options?: TickOptions) {
  const scale = chooseTickScale(pxPerSec, options);
  const ticks: Tick[] = [];
  const first = Math.ceil(startSec / scale.step - 1e-9);
  const last = Math.floor(endSec / scale.step + 1e-9);
  const every = Math.round(scale.labelStep / scale.step);
  for (let i = first; i <= last; i++) {
    const time = Math.round(i * scale.step * 1e6) / 1e6;
    ticks.push({
      time,
      x: (time - startSec) * pxPerSec,
      label: i % every === 0 ? formatTime(time, scale.decimals) : undefined,
    });
  }
  return { scale, ticks };
}
