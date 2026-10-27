/**
 * Giờ mùa hè (DST) không cần thư viện.
 *
 * Hai ý tưởng từ code thật:
 * - Udemy (utils/pacific-timezone.ts): tự tính hai mốc đổi giờ của Pacific Time theo luật Mỹ,
 *   và chọn offset cho giờ 1am bị lặp lại khi lùi đồng hồ bằng một "gợi ý".
 * - Pipedrive (calendar-view/utils/grid.js): đổi toạ độ pixel trên lịch thành giờ, có bù
 *   chênh lệch offset khi ngày đó đổi giờ.
 *
 * Bản viết lại dùng thêm Intl.DateTimeFormat (có sẵn cơ sở dữ liệu múi giờ IANA của trình
 * duyệt) để làm việc với BẤT KỲ múi giờ nào, không riêng Pacific.
 *
 * Quy ước dấu: offset tính bằng phút, DƯƠNG nếu múi giờ đi trước UTC (giống "+07:00").
 * Ngược dấu với Date.prototype.getTimezoneOffset() và với số 420/480 của Udemy.
 */

export interface WallTime {
  year: number;
  /** 1–12 */
  month: number;
  day: number;
  hour: number;
  minute: number;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// ---------------------------------------------------------------------------
// 1. Luật cố định kiểu Udemy: Pacific Time
// ---------------------------------------------------------------------------

/** Ngày thứ `n` (1 = đầu tiên) là `weekday` (0 = Chủ nhật) trong tháng, lúc `hourUTC` giờ UTC. */
function nthWeekdayUTC(year: number, monthIndex: number, weekday: number, n: number, hourUTC: number) {
  const first = new Date(Date.UTC(year, monthIndex, 1, hourUTC));
  const shift = (weekday - first.getUTCDay() + 7) % 7;
  return new Date(Date.UTC(year, monthIndex, 1 + shift + (n - 1) * 7, hourUTC));
}

/** Chủ nhật cuối cùng của tháng, lúc `hourUTC` giờ UTC. */
function lastSundayUTC(year: number, monthIndex: number, hourUTC: number) {
  const last = new Date(Date.UTC(year, monthIndex + 1, 0, hourUTC));
  return new Date(Date.UTC(year, monthIndex, last.getUTCDate() - last.getUTCDay(), hourUTC));
}

/**
 * Hai thời điểm Pacific Time đổi giờ trong năm: [bắt đầu DST, kết thúc DST].
 * Đổi giờ lúc 2:00 sáng giờ địa phương: 2:00 PST = 10:00 UTC, 2:00 PDT = 9:00 UTC.
 *
 * Từ 2007 (Energy Policy Act 2005): Chủ nhật thứ 2 tháng 3 → Chủ nhật đầu tháng 11.
 * 1987–2006: Chủ nhật đầu tháng 4 → Chủ nhật cuối tháng 10. Bản của Udemy chỉ có luật mới.
 */
export function getPacificDSTRange(year: number): [Date, Date] {
  if (year >= 2007) {
    return [nthWeekdayUTC(year, 2, 0, 2, 10), nthWeekdayUTC(year, 10, 0, 1, 9)];
  }
  return [nthWeekdayUTC(year, 3, 0, 1, 10), lastSundayUTC(year, 9, 9)];
}

/** Offset của Pacific Time tại một thời điểm: -420 (PDT, UTC−7) hoặc -480 (PST, UTC−8). */
export function getPacificOffset(instant: Date | number): number {
  const date = new Date(instant);
  const [start, end] = getPacificDSTRange(date.getUTCFullYear());
  return date >= start && date < end ? -420 : -480;
}

// ---------------------------------------------------------------------------
// 2. Bất kỳ múi giờ nào, dùng Intl
// ---------------------------------------------------------------------------

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string) {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    // Tạo Intl.DateTimeFormat khá tốn: cache theo múi giờ.
    // hourCycle 'h23': tránh giờ "24" mà hour12:false trả về ở một số engine cũ.
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/** Giờ đồng hồ treo tường (wall time) tại `timeZone` ở thời điểm `instant`. */
export function toWallTime(instant: Date | number, timeZone: string): WallTime & { second: number } {
  const parts: Record<string, number> = {};
  for (const part of formatterFor(timeZone).formatToParts(new Date(instant))) {
    if (part.type !== 'literal') parts[part.type] = Number(part.value);
  }
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
  };
}

/** Offset (phút, dương = trước UTC) của `timeZone` tại thời điểm `instant`. */
export function getOffset(timeZone: string, instant: Date | number): number {
  const ms = new Date(instant).getTime();
  const wall = toWallTime(ms, timeZone);
  const asUTC = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  // Intl chỉ trả tới giây: bỏ phần mili giây của instant trước khi trừ
  return Math.round((asUTC - (ms - (((ms % 1000) + 1000) % 1000))) / MINUTE);
}

const sameWall = (a: WallTime, b: WallTime) =>
  a.year === b.year && a.month === b.month && a.day === b.day && a.hour === b.hour && a.minute === b.minute;

/**
 * Cách chọn khi giờ treo tường không tồn tại (gap, lúc tiến đồng hồ) hoặc có hai lần (overlap,
 * lúc lùi đồng hồ). Cùng tên với tuỳ chọn `disambiguation` của Temporal.
 * - compatible: gap → đẩy về sau (giống new Date(y, m, d, h)), overlap → lần đầu
 * - earlier / later: chọn thời điểm sớm hơn / muộn hơn
 * - reject: ném lỗi
 */
export type Disambiguation = 'compatible' | 'earlier' | 'later' | 'reject';

export type WallKind = 'normal' | 'gap' | 'overlap';

/** Mọi thời điểm (epoch ms) có giờ treo tường đúng bằng `wall`, kèm loại (bình thường/gap/overlap). */
export function resolveWallTime(wall: WallTime, timeZone: string) {
  const utcGuess = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute);
  // Offset trước và sau mọi lần đổi giờ quanh đó: lấy cách 1 ngày về hai phía
  const offsetBefore = getOffset(timeZone, utcGuess - DAY);
  const offsetAfter = getOffset(timeZone, utcGuess + DAY);
  const candidates = [...new Set([offsetBefore, offsetAfter])]
    .map((offset) => utcGuess - offset * MINUTE)
    .filter((instant) => sameWall(toWallTime(instant, timeZone), wall))
    .sort((a, b) => a - b);

  if (candidates.length === 2) return { kind: 'overlap' as WallKind, instants: candidates, offsetBefore, offsetAfter };
  if (candidates.length === 1) return { kind: 'normal' as WallKind, instants: candidates, offsetBefore, offsetAfter };
  return { kind: 'gap' as WallKind, instants: [] as number[], offsetBefore, offsetAfter };
}

export class NonexistentTimeError extends Error {}

/** Giờ treo tường tại `timeZone` → thời điểm (epoch ms). */
export function fromWallTime(wall: WallTime, timeZone: string, disambiguation: Disambiguation = 'compatible'): number {
  const { kind, instants, offsetBefore, offsetAfter } = resolveWallTime(wall, timeZone);
  if (kind === 'normal') return instants[0];
  if (disambiguation === 'reject') {
    throw new NonexistentTimeError(kind === 'gap' ? 'Giờ này không tồn tại (gap)' : 'Giờ này xảy ra hai lần (overlap)');
  }
  if (kind === 'overlap') return disambiguation === 'later' ? instants[1] : instants[0];

  // Gap: dùng offset TRƯỚC khi đổi giờ → rơi vào sau mốc đổi (vd 2:30 → 3:30).
  // Dùng offset SAU → rơi vào trước mốc đổi (vd 2:30 → 1:30).
  const utcGuess = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute);
  return disambiguation === 'earlier' ? utcGuess - offsetAfter * MINUTE : utcGuess - offsetBefore * MINUTE;
}

export interface Transition {
  instant: number;
  offsetBefore: number;
  offsetAfter: number;
}

/** Các lần đổi offset của `timeZone` trong năm (thường 0 hoặc 2 lần). */
export function findTransitions(timeZone: string, year: number): Transition[] {
  const result: Transition[] = [];
  const end = Date.UTC(year + 1, 0, 1);
  let prev = Date.UTC(year, 0, 1);
  let prevOffset = getOffset(timeZone, prev);
  // Bước 1 ngày: đủ nhỏ vì hai lần đổi giờ không bao giờ cách nhau dưới 1 ngày
  for (let t = prev + DAY; t <= end; t += DAY) {
    const offset = getOffset(timeZone, t);
    if (offset !== prevOffset) {
      // Chia đôi tới mức 1 phút
      let lo = prev;
      let hi = t;
      while (hi - lo > MINUTE) {
        const mid = lo + Math.floor((hi - lo) / 2 / MINUTE) * MINUTE;
        if (getOffset(timeZone, mid) === prevOffset) lo = mid;
        else hi = mid;
      }
      result.push({ instant: hi, offsetBefore: prevOffset, offsetAfter: offset });
    }
    prev = t;
    prevOffset = offset;
  }
  return result;
}

// ---------------------------------------------------------------------------
// 3. Đếm ngày và đổi pixel → giờ
// ---------------------------------------------------------------------------

/** Số ngày lịch giữa hai ngày treo tường: không phụ thuộc DST vì tính trên Date.UTC. */
export function calendarDaysBetween(a: Pick<WallTime, 'year' | 'month' | 'day'>, b: Pick<WallTime, 'year' | 'month' | 'day'>) {
  return Math.round((Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / DAY);
}

export type SlotStrategy = 'duration' | 'compensate' | 'wallclock';

/**
 * Ô thứ `minutes` phút tính từ đầu ngày trên lịch (y = minutes / 60 * chiều cao một giờ) → thời điểm.
 * - duration: đầu ngày + minutes phút thời gian thật (moment.add) — lệch 1 giờ sau mốc đổi giờ
 * - compensate: như Pipedrive — cộng minutes rồi bù chênh lệch offset giữa đầu ngày và kết quả
 * - wallclock: đặt thẳng giờ treo tường hh:mm rồi đổi ra thời điểm (fromWallTime)
 */
export function slotToInstant(
  day: Pick<WallTime, 'year' | 'month' | 'day'>,
  minutes: number,
  timeZone: string,
  strategy: SlotStrategy,
): number {
  // Đầu ngày cũng phải đi qua fromWallTime: vài múi giờ đổi giờ đúng lúc 00:00
  const startOfDay = fromWallTime({ ...day, hour: 0, minute: 0 }, timeZone);
  if (strategy === 'wallclock') {
    return fromWallTime({ ...day, hour: Math.floor(minutes / 60), minute: minutes % 60 }, timeZone);
  }
  const due = startOfDay + minutes * MINUTE;
  if (strategy === 'duration') return due;
  // Pipedrive: offset lúc đầu ngày khác offset lúc `due` → ngày này đổi giờ, bù phần chênh
  const startOffset = getOffset(timeZone, startOfDay);
  const dueOffset = getOffset(timeZone, due);
  if (startOffset === dueOffset) return due;
  const candidate = due + (startOffset - dueOffset) * MINUTE;
  // Ngày tiến đồng hồ: chỉ bù nếu kết quả vẫn ở sau mốc đổi (isTransitioningToDST); ô rơi vào
  // giờ không tồn tại thì giữ nguyên
  if (dueOffset > startOffset && getOffset(timeZone, candidate) !== dueOffset) return due;
  return candidate;
}

// ---------------------------------------------------------------------------
// 4. Hiển thị
// ---------------------------------------------------------------------------

const pad = (n: number) => String(n).padStart(2, '0');

export function formatOffset(offset: number) {
  const sign = offset >= 0 ? '+' : '−';
  const abs = Math.abs(offset);
  return `UTC${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

export function formatWall(instant: number, timeZone: string, withDate = false) {
  const w = toWallTime(instant, timeZone);
  const time = `${pad(w.hour)}:${pad(w.minute)}`;
  return withDate ? `${pad(w.day)}/${pad(w.month)} ${time}` : time;
}
