/**
 * Vạch trục "đẹp" cho biểu đồ (ý tưởng từ CandelaScalingStrategyNumeric/Time của Facebook).
 *
 * Trục số: bước luôn có dạng {1, 2, 5} × 10^k.
 * Trục thời gian: bước chọn trong bảng cố định (1s, 5s, 15s, … 1 năm), so trên thang log
 * để lấy bước gần nhất; vạch được căn theo lịch (đầu phút, đầu giờ, đầu tháng…).
 */

/** Làm tròn một bước thô thành {1, 2, 5} × 10^k gần nhất (ngưỡng giống Candela). */
export function niceStep(rawStep: number) {
  if (!(rawStep > 0) || !Number.isFinite(rawStep)) throw new RangeError(`bước phải > 0, nhận ${rawStep}`);
  const power = Math.pow(10, Math.floor(Math.log10(rawStep)));
  // ratio ∈ (0.1, 1]: nhỏ nghĩa là bước thô lớn so với luỹ thừa 10
  const ratio = power / rawStep;
  if (ratio <= 0.15) return power * 10;
  if (ratio <= 0.35) return power * 5;
  if (ratio <= 0.75) return power * 2;
  return power;
}

/** Số chữ số thập phân cần để in step mà không lộ lỗi dấu phẩy động (0.30000000000000004). */
function decimalsOf(step: number) {
  return Math.max(0, -Math.floor(Math.log10(step)));
}

export interface NumericTicks {
  step: number;
  start: number;
  end: number;
  ticks: number[];
}

/**
 * Mở rộng [min, max] ra bội của bước đẹp rồi sinh vạch.
 * targetCount là số khoảng mong muốn (gợi ý, không đảm bảo chính xác).
 */
export function numericTicks(min: number, max: number, targetCount = 5): NumericTicks {
  if (min > max) [min, max] = [max, min];
  if (min === max) {
    // miền rỗng: lấy một khoảng quanh giá trị để vẫn có trục
    const pad = min === 0 ? 1 : Math.abs(min) * 0.1;
    min -= pad;
    max += pad;
  }
  const step = niceStep((max - min) / Math.max(1, targetCount));
  const start = Math.floor(min / step) * step;
  const end = Math.ceil(max / step) * step;
  const decimals = decimalsOf(step);
  const ticks: number[] = [];
  const count = Math.round((end - start) / step);
  for (let i = 0; i <= count; i++) {
    // nhân từ start thay vì cộng dồn để sai số không tích luỹ, rồi cắt về số chữ số của step
    ticks.push(Number((start + i * step).toFixed(decimals)));
  }
  return { step, start, end, ticks };
}

// ---- Trục thời gian ----

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY; // xấp xỉ, chỉ dùng để chọn bước
const YEAR = 365 * DAY;

/** Bảng bước giống Candela.TIME_STEPS (tính bằng ms). */
export const TIME_STEPS = [
  SECOND, 5 * SECOND, 15 * SECOND, 30 * SECOND,
  MINUTE, 5 * MINUTE, 15 * MINUTE, 30 * MINUTE,
  HOUR, 2 * HOUR, 3 * HOUR, 6 * HOUR, 12 * HOUR,
  DAY, 2 * DAY, 3 * DAY,
  WEEK, 2 * WEEK,
  MONTH, 3 * MONTH, 6 * MONTH,
  YEAR,
];

type Unit = 'year' | 'month' | 'week' | 'day' | 'hour' | 'minute' | 'second' | 'ms';
const UNITS: Array<[Unit, number]> = [
  ['year', YEAR],
  ['month', MONTH],
  ['week', WEEK],
  ['day', DAY],
  ['hour', HOUR],
  ['minute', MINUTE],
  ['second', SECOND],
  ['ms', 1],
];

/** Chỉ số phần tử nhỏ nhất ≥ value (lower bound). */
function lowerBound(sorted: number[], value: number) {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Chọn bước thời gian đẹp cho bước thô rawStep (ms).
 * - Lớn hơn 1 năm: dùng niceStep trên đơn vị năm (1, 2, 5, 10 năm…).
 * - Nhỏ hơn 1 giây: dùng niceStep trên ms (bản gốc ném invariant ở đây).
 * - Còn lại: lấy hai bước kề nhau trong bảng, chọn bước gần hơn theo tỉ lệ (trung bình nhân).
 */
export function niceTimeStep(rawStep: number) {
  if (!(rawStep > 0)) throw new RangeError(`bước phải > 0, nhận ${rawStep}`);
  const i = lowerBound(TIME_STEPS, rawStep);
  if (i === TIME_STEPS.length) return niceStep(rawStep / YEAR) * YEAR;
  if (i === 0) return rawStep >= SECOND ? SECOND : niceStep(rawStep);
  const below = TIME_STEPS[i - 1];
  const above = TIME_STEPS[i];
  // so rawStep/below với above/rawStep: tương đương so log(rawStep) với log của trung bình nhân
  return rawStep / below < above / rawStep ? below : above;
}

/** Tách bước thành (đơn vị lịch, số đơn vị): 3 tháng → ['month', 3], 6 giờ → ['hour', 6]. */
export function stepToUnit(step: number): [Unit, number] {
  for (const [unit, size] of UNITS) {
    if (step >= size) return [unit, Math.max(1, Math.round(step / size))];
  }
  return ['ms', step];
}

/** Lùi t về đầu đơn vị và về bội của count (UTC). */
function floorTo(t: number, unit: Unit, count: number) {
  const d = new Date(t);
  switch (unit) {
    case 'year': {
      const y = Math.floor(d.getUTCFullYear() / count) * count;
      return Date.UTC(y, 0, 1);
    }
    case 'month': {
      const m = Math.floor(d.getUTCMonth() / count) * count;
      return Date.UTC(d.getUTCFullYear(), m, 1);
    }
    case 'week': {
      // căn theo thứ Hai, đếm tuần từ một mốc cố định để bước 2 tuần không bị "gãy" ở đầu năm
      const day = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
      const monday = day - ((d.getUTCDay() + 6) % 7) * DAY;
      const epochMonday = Date.UTC(1970, 0, 5);
      const weeks = Math.floor((monday - epochMonday) / WEEK);
      return epochMonday + Math.floor(weeks / count) * count * WEEK;
    }
    case 'day': {
      const dayIndex = Math.floor(t / DAY);
      return Math.floor(dayIndex / count) * count * DAY;
    }
    default: {
      const size = UNITS.find(([u]) => u === unit)![1];
      return Math.floor(t / (size * count)) * size * count;
    }
  }
}

function addUnit(t: number, unit: Unit, count: number) {
  const d = new Date(t);
  if (unit === 'year') return Date.UTC(d.getUTCFullYear() + count, d.getUTCMonth(), d.getUTCDate());
  if (unit === 'month') return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + count, d.getUTCDate());
  const size = UNITS.find(([u]) => u === unit)![1];
  return t + size * count;
}

export interface TimeTicks {
  step: number;
  unit: Unit;
  count: number;
  ticks: number[];
}

/** Sinh vạch thời gian căn theo lịch (UTC) trong [from, to]. */
export function timeTicks(from: number, to: number, targetCount = 6): TimeTicks {
  if (from > to) [from, to] = [to, from];
  const step = niceTimeStep(Math.max(1, (to - from) / Math.max(1, targetCount)));
  const [unit, count] = stepToUnit(step);
  const ticks: number[] = [];
  let t = floorTo(from, unit, count);
  // tối đa 1000 vạch để không treo nếu tham số lạ
  while (t <= to && ticks.length < 1000) {
    if (t >= from) ticks.push(t);
    t = addUnit(t, unit, count);
  }
  return { step, unit, count, ticks };
}
