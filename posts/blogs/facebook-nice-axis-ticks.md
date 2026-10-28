---
title: 'Học từ Facebook #64: Vạch trục số và trục thời gian "đẹp" cho biểu đồ'
description: 'Candela, thư viện biểu đồ nội bộ của Facebook, làm tròn bước trục về {1, 2, 5} × 10^k bằng ba ngưỡng tỉ lệ, chọn bước thời gian từ một bảng cố định theo trung bình nhân, và căn vạch theo lịch.'
date: '2026-10-28T09:14'
series: facebook
seriesOrder: 64
author: hunghg255
image: https://blog.hunghg.me/blogs/fb-nice-ticks.png
tags: ['facebook', 'chart', 'dataviz', 'algorithm', 'date']
---

Vẽ biểu đồ doanh thu từ 3,7 tới 71,2 triệu, muốn khoảng 5 vạch trên trục. Chia đều thì được `3.7, 17.2, 30.7, 44.2, 57.7, 71.2`: đúng toán học, nhưng không ai đọc nổi. Người đọc biểu đồ chờ đợi `0, 20, 40, 60, 80`.

Trục thời gian còn khó hơn: khoảng 6 giờ thì vạch nên ở `10:00, 11:00, 12:00`, không phải `09:47:13, 10:47:13`; khoảng 9 tháng thì vạch ở **đầu tháng**, mà tháng thì dài ngắn khác nhau.

Thư viện biểu đồ nội bộ của Facebook tên **Candela** (dùng trong các dashboard quảng cáo, insight trang) giải cả hai bằng vài chục dòng code.

> [!TIP]
> **Tóm tắt**
> - Bước "đẹp" có dạng {1, 2, 5} × 10^k. Lấy luỹ thừa 10 ngay dưới bước thô, tính tỉ lệ `power / rawStep` rồi so ba ngưỡng `0.15`, `0.35`, `0.75`.
> - Mở rộng miền dữ liệu ra bội của bước (`floor(min / step) * step`, `ceil(max / step) * step`) để vạch đầu và cuối rơi đúng số tròn.
> - Trục thời gian: bảng bước cố định `1s, 5s, 15s, 30s, 1m, … 6 tháng, 1 năm`. Tìm hai bước kẹp bước thô, chọn bước gần hơn **theo tỉ lệ** (so `raw / dưới` với `trên / raw`). Lớn hơn 1 năm thì quay lại thuật toán số, đơn vị năm.
> - Vạch thời gian phải căn theo lịch (đầu giờ, đầu tháng), không phải cộng đều mili-giây.

<iframe class="demo-frame" src="/demos/facebook-patterns/index.html?theme=dark#/nice-ticks" title="Demo nice-ticks" loading="lazy" style="height: 1060px"></iframe>

<p class="demo-links">▶ <a href="/demos/facebook-patterns/index.html#/nice-ticks" target="_blank" rel="noopener">Mở demo toàn màn hình ↗</a> · <a href="https://stackblitz.com/github/hunghg255/blog-hunghg/tree/master/examples/facebook-patterns?file=src/lib/niceTicks.ts" target="_blank" rel="noopener">Sửa code trên StackBlitz ↗</a> · <a href="https://github.com/hunghg255/blog-hunghg/blob/master/examples/facebook-patterns/src/lib/niceTicks.ts" target="_blank" rel="noopener">Xem source trên GitHub ↗</a></p>

## Facebook làm thế nào?

### Trục số: CandelaScalingStrategyNumeric

Hàm `__calculateNiceStep(rawStep, props)` sau khi rút gọn (bản gốc tính `extent / rawStep / extent * power`, triệt tiêu còn `power / rawStep`):

```js
function niceStep(rawStep) {
  let power = Math.pow(10, Math.floor(Math.log(rawStep) / Math.LN10)); // luỹ thừa 10 ≤ rawStep
  const ratio = power / rawStep;            // thuộc (0.1, 1]
  if (ratio <= 0.15) power *= 10;           // rawStep ≥ 6.67·power → 10
  else if (ratio <= 0.35) power *= 5;       // rawStep ≥ 2.86·power → 5
  else if (ratio <= 0.75) power *= 2;       // rawStep ≥ 1.33·power → 2
  return power;                              // còn lại → 1
}
```

Đổi ngưỡng ra "bước thô bằng bao nhiêu lần luỹ thừa 10" cho dễ hình dung:

| rawStep / power | bước chọn |
|---|---|
| 1 tới 1,33 | 1 × power |
| 1,33 tới 2,86 | 2 × power |
| 2,86 tới 6,67 | 5 × power |
| 6,67 tới 10 | 10 × power |

Ranh giới không nằm ở trung điểm: `1,33 ≈ 4/3`, `2,86 ≈ 20/7`, `6,67 = 20/3`. Chúng thấp hơn trung bình nhân (`√2 ≈ 1,41`, `√10 ≈ 3,16`, `√50 ≈ 7,07`) mà d3 dùng: bước thô `1,35 × power` thì Candela đã chọn 2, d3 vẫn chọn 1. Nghĩa là Candela hơi ưu tiên **bước lớn, ít vạch** để nhãn thoáng hơn.

Bước thô đến từ đâu? `__finalizeProps` nhận hoặc `stepCountHint` (số vạch mong muốn), hoặc `stepIntervalHint` (khoảng cách pixel mong muốn giữa hai vạch), hoặc cả hai:

```js
let count = stepCountHint;
if (stepIntervalHint) {
  count = Math.max(Math.round(outputPixels / stepIntervalHint), 1); // trục 600px, mỗi vạch 100px → 6
  if (stepCountHint) count = Math.min(count, stepCountHint);
}
let step = inputExtent / count;
if (roundInput || niceStepOnly) {
  step = this.__calculateNiceStep(step, props);
  if (roundInput) {
    input = this.__roundInput(step, props);          // nới miền ra bội của bước
    count = Math.round(extent(input) / step);
  } else count = extent(input) / step;
}
```

`__roundInput` nới hai đầu miền ra bội của bước, có tính tới `origin` (mặc định 0): đầu nhỏ dùng `Math.floor((a - origin) / step) * step + origin`, đầu lớn dùng `Math.ceil`. Có `origin` để trục có thể "neo" vào một giá trị khác 0, ví dụ vạch luôn đi qua 100%.

Thêm hai chi tiết: `firstPadding`/`lastPadding` tính bằng **số bước** (đệm 0,5 bước mỗi đầu để điểm dữ liệu không dính sát mép), và khi miền rỗng (`min === max`), Candela không chia cho 0 mà trả `normalizedOutputWhenNoExtent` (mặc định vẽ ở mép trái).

### Trục thời gian: CandelaScalingStrategyTime

`CandelaConstants.TIME_STEPS` là bảng cố định:

```js
[SEC, SEC*5, SEC*15, SEC*30, MIN, MIN*5, MIN*15, MIN*30,
 HOUR, HOUR*2, HOUR*3, HOUR*6, HOUR*12, DAY, DAY*2, DAY*3,
 WEEK, WEEK*2, MONTH, MONTH*3, MONTH*6, YEAR]
```

Đây là những bước con người quen đọc: 15 phút, 6 giờ, 3 tháng. Không có 7 giờ hay 4 tháng. `__calculateNiceStep` tìm trong bảng:

```js
let i = BinarySearch.findBoundInArray(steps, raw, (a, b) => a - b, LEAST_UPPER_BOUND);
invariant(i, '…');                                   // i === 0 → lỗi
if (i === steps.length) {                            // lớn hơn 1 năm
  const yearsInput = input.map((t) => t / YEAR);
  return super.__calculateNiceStep(raw / YEAR, { ...props, input: yearsInput }) * YEAR;
}
if (raw / steps[i - 1] < steps[i] / raw) {           // bước dưới gần hơn theo tỉ lệ
  if (stepIntervalHint && minStepInterval) {
    // chỉ lấy bước dưới nếu khoảng pixel giữa hai vạch vẫn ≥ minStepInterval
    const lower = steps[i - 1];
    const count = extent(this.__roundInput(lower, props)) / lower + firstPadding + lastPadding;
    if (outputPixels / count >= minStepInterval) i -= 1;
  } else i -= 1;
}
return steps[i];
```

Ba điều đáng học:

1. **So theo tỉ lệ, không theo hiệu.** Bước thô 40 phút nằm giữa 30 và 60 phút: `40/30 = 1,33 < 60/40 = 1,5` nên chọn 30. Bước thô 45 phút cách đều 30 và 60 nếu tính theo hiệu, nhưng theo tỉ lệ `45/30 = 1,5 > 60/45 = 1,33` nên chọn 60. Ranh giới thật nằm ở `√(30 × 60) ≈ 42,4` phút. Phép so này tương đương so `log(raw)` với `log` của **trung bình nhân** `√(dưới × trên)`, phù hợp vì các bước trong bảng tăng theo cấp số nhân.
2. **Kiểm tra lại bằng pixel.** Bước nhỏ hơn đồng nghĩa nhiều vạch hơn. Nếu trục hẹp, Candela tính thử khoảng cách pixel với bước nhỏ, dưới `minStepInterval` thì giữ bước lớn. Đây là lý do nhãn không đè lên nhau trên biểu đồ nhỏ.
3. **Trên 1 năm, quay lại thuật toán số.** 30 năm không có trong bảng, nên đổi đơn vị sang năm và dùng {1, 2, 5} × 10^k: bước 5 năm, 10 năm, 20 năm.

Lưu ý `invariant(i, …)`: khi bước thô **không vượt quá 1 giây**, `i` bằng 0 và Candela ném lỗi. Biểu đồ hiệu năng (thời gian phản hồi tính bằng ms) không dùng được trục thời gian này; có lẽ những biểu đồ đó dùng trục số với đơn vị ms.

Phần sinh vạch dùng `DateTime` và `PeriodUnit` của Facebook (có múi giờ, mặc định `Timezone.UTC`) để cộng "1 tháng" theo lịch chứ không cộng 30 ngày.

## Viết lại

Bản viết lại tách ba hàm thuần: `niceStep` (bước số), `numericTicks` (nới miền + sinh vạch), `niceTimeStep` + `timeTicks` (trục thời gian, UTC).

```ts title=src/lib/niceTicks.ts
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
```

Trục thời gian: chọn bước, đổi bước ra (đơn vị lịch, số đơn vị), lùi mốc đầu về đầu đơn vị rồi cộng theo lịch:

```ts title=src/lib/niceTicks.ts
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
```

```ts title=src/lib/niceTicks.ts
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
```

::: spoiler Xem toàn bộ src/lib/niceTicks.ts

```ts title=src/lib/niceTicks.ts
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
```

:::

## Đi qua code

- **`niceStep`** giữ nguyên ngưỡng của Candela. Kiểm tra `rawStep > 0` và hữu hạn, vì `Math.log10(0)` là `-Infinity` và vòng sinh vạch phía sau sẽ chạy mãi.
- **`numericTicks`** nhân `start + i * step` thay vì cộng dồn `t += step`. Cộng dồn `0.1` mười lần ra `0.9999999999999999`; nhân thì sai số không tích luỹ. Sau đó `toFixed(decimalsOf(step))` cắt về đúng số chữ số của bước, nên `[0.1, 0.3]` ra `0.1, 0.15, 0.2, 0.25, 0.3` chứ không phải `0.15000000000000002`.
- **Miền rỗng** (`min === max`, ví dụ mọi điểm bằng 5): nới ra ±10% (hoặc ±1 nếu bằng 0) để vẫn có trục, thay vì chia cho 0.
- **`niceTimeStep`** dùng `lowerBound` tự viết trên bảng 22 phần tử. Bước thô dưới 1 giây thì dùng `niceStep` trên đơn vị ms (100ms, 200ms, 500ms) thay vì ném lỗi.
- **`stepToUnit`** đổi bước ra cặp `['hour', 6]`, `['month', 3]`. Bước tháng/năm tính bằng 30/365 ngày chỉ để **chọn**; khi sinh vạch thì cộng theo lịch.
- **`floorTo`** lùi về đầu đơn vị và về **bội** của số đơn vị: bước 3 tháng thì vạch ở tháng 1, 4, 7, 10; bước 6 giờ thì 0h, 6h, 12h, 18h. Tuần căn theo thứ Hai, đếm từ một thứ Hai cố định (5/1/1970) để bước 2 tuần không bị lệch nhịp khi qua năm mới.
- **`addUnit`** cộng tháng/năm bằng `Date.UTC(y, m + count, d)`: luôn từ ngày 1 nên không gặp lỗi "31/1 + 1 tháng = 3/3".

**Khác bản gốc:**
- Hỗ trợ bước dưới 1 giây thay vì ném invariant.
- Chỉ UTC. Candela có tham số `timezoneID`; muốn vạch ở nửa đêm giờ Việt Nam thì cộng/trừ độ lệch múi giờ trước và sau khi tính (UTC+7 không có giờ mùa hè nên làm được), hoặc dùng `Temporal`/thư viện múi giờ.
- Bỏ `minStepInterval` theo pixel; demo xin ít vạch hơn (4 thay vì 6) khi màn hình hẹp. Muốn đầy đủ, truyền chiều rộng trục vào `timeTicks` rồi tính `targetCount = floor(width / 80)`.

## Tại sao không làm cách khác?

**Chia đều rồi làm tròn số hiển thị?** `toFixed(0)` trên `17.2, 30.7` cho `17, 31`: vạch vẫn ở vị trí lẻ, chỉ nhãn bị nói dối. Người đọc so cột với vạch sẽ đọc sai.

**Chỉ dùng {1, 2, 5} cho cả thời gian?** 50 giây, 20 phút thì được, nhưng 2 giờ, 5 giờ, 10 giờ trên trục 24 giờ thì không khớp nhịp ngày (5 không chia hết 24). Bảng của Candela chỉ có 1, 2, 3, 6, 12 giờ, đều là ước của 24; 1, 3, 6 tháng là ước của 12.

**Cộng đều 30 ngày cho "1 tháng"?** Sau 6 vạch đã lệch sang ngày 26 hay 27 của tháng. Vạch tháng phải rơi đúng ngày 1.

**Thuật toán "Extended Wilkinson" (Talbot, Lin, Hanrahan 2010)?** Chấm điểm nhiều ứng viên theo độ đơn giản, độ phủ, mật độ, chọn tốt nhất. Đẹp hơn trong vài trường hợp (cho phép bước 2,5 hay 4) nhưng code dài và chậm hơn. Ba ngưỡng của Candela là đủ cho hầu hết dashboard.

## Edge case và cạm bẫy

- **Số âm.** `Math.floor(-48 / 200) * 200 = -200`: `floor` đi về âm vô cực nên miền vẫn bao lấy `min`. Đừng thay bằng `Math.trunc`.
- **Số rất lớn hoặc rất nhỏ.** `numericTicks(0, 1e-12)` vẫn chạy, nhưng nhãn cần định dạng khoa học hoặc đơn vị (ns, µs). Phần định dạng nhãn là việc riêng, nên dùng `Intl.NumberFormat` với `notation: 'compact'`.
- **Vạch nằm ngoài dữ liệu.** Miền được nới ra nên trục có thể dài hơn dữ liệu gần một bước. Nếu không muốn khoảng trống, chỉ dùng `step` để sinh vạch **bên trong** `[min, max]` như `timeTicks` đang làm.
- **Giờ mùa hè (DST).** Ở múi giờ có DST, "mỗi 6 giờ" theo giờ địa phương có ngày chỉ có 23 hoặc 25 giờ. Làm việc trong UTC rồi định dạng nhãn theo giờ địa phương thì vạch đều nhưng nhãn lệch giờ; làm theo giờ địa phương thì nhãn tròn nhưng khoảng cách không đều. Candela chọn tính trong múi giờ được truyền vào.
- **Giới hạn số vạch.** `timeTicks` dừng ở 1000 vạch để tham số lạ (khoảng 100 năm với bước 1 giây) không treo trình duyệt.

## Dùng trong dự án

```ts
import { numericTicks, timeTicks } from './niceTicks';

// Trục Y cho biểu đồ cột SVG cao 300px
const { start, end, ticks } = numericTicks(Math.min(...values), Math.max(...values), 5);
const y = (v: number) => 300 - ((v - start) / (end - start)) * 300;
ticks.forEach((t) => drawLine(0, y(t), width, y(t), format(t)));

// Trục X thời gian, số vạch theo chiều rộng
const tx = timeTicks(from, to, Math.max(2, Math.floor(width / 90)));
const label = new Intl.DateTimeFormat('vi-VN', tx.unit === 'month' ? { month: 'short' } : { hour: '2-digit', minute: '2-digit' });
```

## Kiểm thử

::: spoiler Ví dụ test (bản phác, không có trong repo)

```ts
import { describe, expect, it } from 'vitest';
import { niceStep, niceTimeStep, numericTicks, timeTicks } from './niceTicks';

describe('niceStep', () => {
  it('làm tròn về {1, 2, 5} × 10^k theo ngưỡng Candela', () => {
    expect([0.7, 1.2, 3, 6, 8, 13.5].map(niceStep)).toEqual([1, 1, 5, 5, 10, 20]);
  });
  it('nới miền và không lộ sai số dấu phẩy động', () => {
    expect(numericTicks(3.7, 71.2, 5).ticks).toEqual([0, 20, 40, 60, 80]);
    expect(numericTicks(0.1, 0.3, 5).ticks).toEqual([0.1, 0.15, 0.2, 0.25, 0.3]);
  });
});

describe('time', () => {
  const from = Date.UTC(2026, 9, 28, 9, 47, 13, 250);
  it('chọn bước trong bảng theo tỉ lệ, dưới 1 giây vẫn chạy', () => {
    expect(niceTimeStep(40 * 60_000)).toBe(30 * 60_000);
    expect(niceTimeStep(66.7)).toBe(100);
  });
  it('căn vạch theo lịch', () => {
    const t = timeTicks(from, from + 270 * 86_400_000, 6);
    expect(t.unit).toBe('month');
    expect(new Date(t.ticks[0]).toISOString()).toBe('2026-11-01T00:00:00.000Z');
    const y = timeTicks(from, from + 30 * 365 * 86_400_000, 6);
    expect([y.unit, y.count]).toEqual(['year', 5]);
  });
});
```

:::

## So với thư viện và chuẩn web

- **d3-scale** (`scaleLinear().nice().ticks(5)`) dùng cùng ý tưởng {1, 2, 5} × 10^k với ngưỡng theo trung bình nhân (√50, √10, √2). `scaleTime().ticks()` của d3 cũng có bảng bước tương tự (1, 5, 15, 30 giây; 1, 3, 6, 12 giờ…) và căn theo lịch qua `d3-time`. Nếu đã dùng d3, dùng của d3.
- **Chart.js**, **ECharts**, **Recharts** đều có thuật toán "nice" riêng; biết nguyên lý giúp bạn hiểu vì sao trục tự nới ra và cách tắt nó (`nice: false`, `min`/`max` cố định).
- `Intl.DateTimeFormat` và `Intl.NumberFormat` lo phần nhãn theo ngôn ngữ; `Temporal` (đang dần có trong trình duyệt, tính tới 10/2026) giúp cộng tháng theo múi giờ dễ hơn `Date`.

Bài liên quan: [Học từ Facebook #71: engine múi giờ IANA trên client](/blogs/facebook-client-iana-timezone).

---

Bài này thuộc series **[Học từ mã nguồn Facebook](/series/facebook)** (83 bài, đọc theo thứ tự).

::: spoiler Xem nhanh danh sách bài trong series

*Phần 1*

- [Mở đầu: cách đọc code minify của Facebook](/blogs/learn-from-facebook-source-code)
- [#1 Dùng chung IntersectionObserver + infinite scroll](/blogs/facebook-shared-intersection-observer)
- [#2 useViewportDuration: đo thời gian thực sự được xem](/blogs/facebook-use-viewport-duration)
- [#3 Preload code + data khi hover](/blogs/facebook-preload-on-hover)
- [#4 Toast manager với external store](/blogs/facebook-toast-manager)
- [#5 Network status + heartbeat backoff](/blogs/facebook-network-status-heartbeat)
- [#6 ErrorGuard: bắt lỗi theo ngữ cảnh](/blogs/facebook-error-guard)
- [#7 Banzai: gom log theo lô + sendBeacon](/blogs/facebook-batch-logger)
- [#8 Focus trap + Esc theo layer](/blogs/facebook-focus-trap)

*Phần 2*

- [#9 Mẹo calc(… * 9999): container query, line-clamp, mũi tên carousel bằng CSS](/blogs/facebook-css-9999-trick)
- [#10 Thanh cuộn tuỳ biến bằng CSS 3D](/blogs/facebook-css-3d-scrollbar)
- [#11 Modal cuộn bằng window, giữ vị trí trang nền](/blogs/facebook-document-scroll-modal)
- [#12 Popover, tooltip group và hovercard](/blogs/facebook-popover-tooltip)
- [#13 Primitive Pressable + focus-visible](/blogs/facebook-pressable)
- [#14 Tab "Xem thêm" + sticky header bằng IntersectionObserver](/blogs/facebook-priority-tabs-sticky-header)
- [#15 Avatar khoét mask, gradient Messenger, skeleton steps()](/blogs/facebook-visual-tricks)
- [#16 Khung chat không giật](/blogs/facebook-chat-scroller)
- [#17 Thuật toán chọn bố cục collage ảnh](/blogs/facebook-photo-collage-layout)
- [#18 Keep-alive tab trong SPA](/blogs/facebook-keep-alive-tabs)
- [#19 Tự đo Visual Completion & interaction tracing](/blogs/facebook-visual-completion)
- [#20 Router SPA bền bỉ & tải chunk có retry](/blogs/facebook-spa-router-resilient-loading)

*Phần 3*

- [#21 Smart Compose: gợi ý chữ mờ khi gõ](/blogs/facebook-smart-compose-ghost-text)
- [#22 MQTT ngay trong trình duyệt, tự chuyển sang long-poll](/blogs/facebook-mqtt-in-browser)
- [#23 Đo thời gian dùng bằng bitmap 64 giây](/blogs/facebook-time-spent-bitmap)
- [#24 Bảng reaction nhấn giữ rồi trượt](/blogs/facebook-reaction-press-slide)
- [#25 Tìm kiếm gấp dấu, phiên âm và highlight đầu từ](/blogs/facebook-search-diacritics-tokenize)
- [#26 Ring buffer biết trace nào đã mất log](/blogs/facebook-trace-ring-buffer)
- [#27 Engine animation JS: một vòng rAF và solver cubic-bezier](/blogs/facebook-keyframes-loop-cubic-bezier)
- [#28 Bootloader: bitmap tài nguyên đã tải, chỉ reload khi cần](/blogs/facebook-bootloader-bitmap-consistency)
- [#29 Nhận biết click do screen reader tạo ra](/blogs/facebook-virtual-cursor-detection)
- [#30 Tải trước feed theo chất lượng mạng, đoán hạng thiết bị](/blogs/facebook-network-aware-prefetch)
- [#31 Hàng đợi gửi tin chat giữ đúng thứ tự](/blogs/facebook-ordered-send-queue)
- [#32 Gộp lời gọi API trong cùng một tick](/blogs/facebook-api-batcher)
- [#33 Resize ảnh trong pool Web Worker](/blogs/facebook-jpeg-resize-worker-pool)
- [#34 Crop ảnh theo nhiều khuôn mặt](/blogs/facebook-face-aware-crop)
- [#35 Kéo-thả sắp xếp và vùng thả file không nhấp nháy](/blogs/facebook-flicker-free-drag-drop)
- [#36 Tiện ích UI: fade-out, sticky event, hàm huỷ được](/blogs/facebook-ui-utility-hooks)
- [#37 Hạ tầng nhỏ: cookie, hash lỗi, prefetch khi chuột dừng](/blogs/facebook-small-infra-cookie-hash-idle)

*Phần 4–6*

- [#38 Đồng bộ tin nhắn: phát hiện lỗ seqID và fetch bù theo tầng](/blogs/facebook-messenger-sync-seqid-gaps)
- [#39 OTID: ID tin nhắn kiểu Snowflake sinh ở client](/blogs/facebook-otid-client-snowflake)
- [#40 QPL: lấy mẫu từ lúc bắt đầu, đo RTT gửi tin đầu-cuối](/blogs/facebook-qpl-send-rtt)
- [#41 Bộ điều phối request bảy chế độ gộp và chống trùng](/blogs/facebook-request-dispatcher-modes)
- [#42 Thread list theo mốc thời gian, cookie presence có version](/blogs/facebook-threadlist-ranged-presence)
- [#43 Composer dạng plugin: reducer, dirty checker, chuỗi kiểm tra](/blogs/facebook-plugin-composer)
- [#44 Thanh toán bất đồng bộ: subscribe trước, poll dự phòng](/blogs/facebook-async-checkout)
- [#45 Validate số thẻ: sửa lỗi gõ, dải BIN, Luhn](/blogs/facebook-card-validation)
- [#46 Lịch chọn khoảng ngày: bo góc dải chọn, phím đủ bộ, RTL](/blogs/facebook-range-calendar-a11y)
- [#47 Giờ mở cửa theo tuần: qua đêm, gộp khoảng, phần bù](/blogs/facebook-weekly-hours-intervals)
- [#48 Tiến độ đăng realtime: giữ event chờ snapshot, watchdog](/blogs/facebook-realtime-publish-snapshot)
- [#49 Tiền tệ theo đơn vị nhỏ nhất và ô nhập tiền](/blogs/facebook-currency-minor-units)
- [#50 Sửa hàng loạt Empty/Uniform/Mixed, seen/read bằng 2 bit](/blogs/facebook-bulk-edit-seen-bits)
- [#51 Phát hiện script lạ hook vào hàm native](/blogs/facebook-native-hook-detection)
- [#52 localStorage tự dọn khi đầy quota](/blogs/facebook-quota-aware-storage)
- [#53 Cache tuyến do server phân giải, chờ sẵn promise](/blogs/facebook-route-cache-prefetch)
- [#54 Lưới phím mũi tên 2D và focus không làm cuộn trang](/blogs/facebook-focus-table-grid)
- [#55 Tách emoji bằng máy trạng thái](/blogs/facebook-emoji-segmentation)
- [#56 Đọc trước ghi sau trong một frame, con tự biết vị trí](/blogs/facebook-read-then-write-dom)
- [#57 Hàng đợi lệnh cho video và stream sắp lại chunk](/blogs/facebook-video-command-queue)

*Phần 7–10*

- [#58 Ước lượng băng thông EWMA: loại outlier, nhớ qua phiên](/blogs/facebook-bandwidth-ewma-estimator)
- [#59 ABR theo độ tự tin phát và cắt bậc bitrate theo MOS](/blogs/facebook-abr-playback-confidence)
- [#60 Prefetch segment dự đoán từ manifest, parse hộp sidx](/blogs/facebook-dash-predicted-segments)
- [#61 Đọc metadata MP4/MOV ngay trên client](/blogs/facebook-mp4-metadata-client)
- [#62 Upload tiếp tục được: offset, hash dedupe, phát hiện treo](/blogs/facebook-resumable-upload)
- [#63 Fenwick tree: chọn ngẫu nhiên có trọng số và offset dòng](/blogs/facebook-fenwick-weighted-random)
- **#64 Vạch trục số và trục thời gian "đẹp"** (bài này)
- [#65 Damerau-Levenshtein theo dải chéo và tự sửa tên gõ sai](/blogs/facebook-damerau-levenshtein)
- [#66 PRNG có seed, shuffle tái lập và lấy mẫu trace](/blogs/facebook-seeded-prng-sampling)
- [#67 Cặp min/max-heap tái dùng vị trí trong danh sách ảo](/blogs/facebook-dual-heap-buffer-set)
- [#68 Memo nhiều đối số bằng Map/WeakMap và interning object](/blogs/facebook-multikey-memo-interning)
- [#69 Thống kê cửa sổ trượt và đại số khoảng thời gian](/blogs/facebook-moving-stat-intervals)
- [#70 Int64 từ hai số 32-bit, decode UTF, offset theo code point](/blogs/facebook-int64-utf-codepoints)
- [#71 Engine múi giờ IANA trên client, phát hiện lệch giờ](/blogs/facebook-client-iana-timezone)
- [#72 Tự cài semver range](/blogs/facebook-semver-range)
- [#73 Auto-link URL, cắt chữ an toàn, giới hạn LaTeX](/blogs/facebook-autolink-safe-truncate)
- [#74 Parser query kiểu PHP chống prototype pollution](/blogs/facebook-php-query-serializer)
- [#75 Popover tự lật theo phần tràn nhỏ nhất](/blogs/facebook-popover-auto-flip)
- [#76 Tiền tố for(;;) chống JSON hijacking, đọc stream](/blogs/facebook-csrf-prefix-streaming)
- [#77 Chống lộ Referer, linkshim, xoá token trên URL](/blogs/facebook-referrer-linkshim-url-scrub)
- [#78 setImmediate bằng postMessage, gom delta chuột theo frame](/blogs/facebook-setimmediate-mouse-batching)
- [#79 Phát hiện crash qua heartbeat, dò proxy cache hỏng](/blogs/facebook-crash-heartbeat-proxy-check)
- [#80 DPR vào cookie cho ảnh @2x, che khoá trong log](/blogs/facebook-dpr-cookie-secret-redaction)
- [#81 Flux waitFor tự viết và proxy có đệm](/blogs/facebook-flux-dispatch-buffered-proxy)
- [#82 Crop đúng tỉ lệ, xoay sticker bằng ma trận](/blogs/facebook-image-crop-rotation-geometry)

:::

Code + demo: [`examples/facebook-patterns`](https://github.com/hunghg255/blog-hunghg/tree/master/examples/facebook-patterns) · [Mở trên StackBlitz](https://stackblitz.com/github/hunghg255/blog-hunghg/tree/master/examples/facebook-patterns)
