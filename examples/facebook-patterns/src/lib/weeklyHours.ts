/**
 * Giờ mở cửa theo tuần (ý tưởng từ PagesTimeRangeEditorUtilities của Facebook Pages).
 *
 * - Mỗi khoảng: tập ngày trong tuần + giờ bắt đầu/kết thúc tính bằng giây kể từ 0:00.
 * - Khoảng qua đêm (22:00 → 02:00) được tách làm hai: [22:00, 24:00) của ngày đã chọn
 *   và [0:00, 02:00) của NGÀY HÔM SAU, tức (weekday + 1) % 7.
 * - Theo từng ngày: lọc, sắp theo giờ bắt đầu, gộp các khoảng chồng nhau.
 * - Phần bù trong [0, 24h) cho ra "giờ đóng cửa" (hoặc ngược lại, tuỳ dữ liệu là giờ mở hay giờ vắng).
 * - Giờ hiện tại được đọc theo MÚI GIỜ CỦA CỬA HÀNG (Intl), không theo máy người xem.
 */

export const SECONDS_IN_DAY = 86_400;

export interface WeeklyRange {
  id: string;
  /** 0 = Chủ nhật … 6 = thứ Bảy */
  weekdays: number[];
  fromSec: number;
  toSec: number;
}

export interface Bracket {
  from: number;
  to: number;
}

/** Tách khoảng qua đêm thành phần trước nửa đêm và phần sau nửa đêm của ngày hôm sau. */
export function splitOvernight(ranges: WeeklyRange[]): WeeklyRange[] {
  return ranges.flatMap((r) => {
    if (r.fromSec < r.toSec) return [r];
    return [
      { ...r, toSec: SECONDS_IN_DAY },
      // toSec = 0 nghĩa là "tới đúng nửa đêm": phần hôm sau rỗng, bỏ đi
      ...(r.toSec > 0
        ? [{ ...r, id: `${r.id}_overnight`, weekdays: r.weekdays.map((d) => (d + 1) % 7), fromSec: 0 }]
        : []),
    ];
  });
}

/** Các khoảng của một ngày, đã sắp xếp và gộp chỗ chồng nhau. */
export function bracketsForDay(weekday: number, ranges: WeeklyRange[]): Bracket[] {
  const sorted = splitOvernight(ranges)
    .filter((r) => r.weekdays.includes(weekday))
    .sort((a, b) => a.fromSec - b.fromSec);
  const merged: Bracket[] = [];
  for (const r of sorted) {
    const last = merged[merged.length - 1];
    if (last && last.to >= r.fromSec) last.to = Math.max(last.to, r.toSec);
    else merged.push({ from: r.fromSec, to: r.toSec });
  }
  return merged;
}

/** Phần bù trong [0, 24h): từ danh sách giờ mở ra danh sách giờ đóng và ngược lại. */
export function complement(brackets: Bracket[]): Bracket[] {
  const result: Bracket[] = [];
  let cursor = 0;
  for (const b of [...brackets].sort((x, y) => x.from - y.from)) {
    if (cursor < b.from) result.push({ from: cursor, to: b.from });
    // max: an toàn kể cả khi đầu vào chưa được gộp (bản gốc gán thẳng cursor = b.to)
    cursor = Math.max(cursor, b.to);
  }
  if (cursor < SECONDS_IN_DAY) result.push({ from: cursor, to: SECONDS_IN_DAY });
  return result;
}

/** Khoảng nửa mở [from, to): đúng 22:00:00 là đã đóng cửa nếu khoảng kết thúc lúc 22:00. */
export function isInBrackets(secondOfDay: number, brackets: Bracket[]) {
  return brackets.some((b) => secondOfDay >= b.from && secondOfDay < b.to);
}

/** Cách so sánh của bản gốc: isAfter(from) && isBefore(to), hở cả hai đầu. */
export function fbStyleIsInBrackets(secondOfDay: number, brackets: Bracket[]) {
  return brackets.some((b) => secondOfDay > b.from && secondOfDay < b.to);
}

export interface ZonedNow {
  weekday: number;
  secondOfDay: number;
  /** "YYYY-MM-DD" theo múi giờ cửa hàng */
  date: string;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Thứ và giây trong ngày theo giờ treo tường của múi giờ cửa hàng. */
export function zonedNow(instant: Date, timeZone: string): ZonedNow {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      weekday: 'short',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(instant)
      .map((p) => [p.type, p.value]),
  );
  return {
    weekday: WEEKDAYS.indexOf(parts.weekday),
    secondOfDay: Number(parts.hour) * 3600 + Number(parts.minute) * 60 + Number(parts.second),
    date: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

export interface OpenStatus {
  open: boolean;
  /** lần đổi trạng thái tiếp theo, tính bằng số ngày tới và giây trong ngày đó */
  next: { inDays: number; weekday: number; secondOfDay: number } | null;
}

/** Đang mở hay đóng, và khi nào đổi. `openRanges` là các khoảng giờ MỞ cửa. */
export function getOpenStatus(now: ZonedNow, openRanges: WeeklyRange[]): OpenStatus {
  const today = bracketsForDay(now.weekday, openRanges);
  const open = isInBrackets(now.secondOfDay, today);
  // duyệt tối đa 8 ngày (hôm nay + 7) để tìm mốc đổi trạng thái đầu tiên
  for (let inDays = 0; inDays <= 7; inDays++) {
    const weekday = (now.weekday + inDays) % 7;
    const brackets = bracketsForDay(weekday, openRanges);
    const edges = brackets
      .flatMap((b) => [b.from, b.to])
      // 24:00 của hôm nay chỉ là mốc đổi nếu ngày mai không mở tiếp từ 0:00
      .filter((s) => s < SECONDS_IN_DAY || !isInBrackets(0, bracketsForDay((weekday + 1) % 7, openRanges)))
      .filter((s) => s > 0 || !isInBrackets(SECONDS_IN_DAY - 1, bracketsForDay((weekday + 6) % 7, openRanges)))
      .filter((s) => inDays > 0 || s > now.secondOfDay)
      .sort((a, b) => a - b);
    if (edges.length) {
      const s = edges[0];
      return s >= SECONDS_IN_DAY
        ? { open, next: { inDays: inDays + 1, weekday: (weekday + 1) % 7, secondOfDay: 0 } }
        : { open, next: { inDays, weekday, secondOfDay: s } };
    }
  }
  return { open, next: null };
}

/** "hôm nay" / "ngày mai" / tên thứ: so theo SỐ NGÀY TỚI, không theo getDayOfYear() + 1. */
export function dayLabel(inDays: number, weekday: number) {
  if (inDays === 0) return 'hôm nay';
  if (inDays === 1) return 'ngày mai';
  return ['Chủ nhật', 'thứ Hai', 'thứ Ba', 'thứ Tư', 'thứ Năm', 'thứ Sáu', 'thứ Bảy'][weekday];
}

/** Nhãn kiểu bản gốc: so số thứ tự ngày trong năm, nên 31/12 → 1/1 không ra "ngày mai". */
export function fbStyleDayLabel(todayDayOfYear: number, targetDayOfYear: number) {
  if (todayDayOfYear === targetDayOfYear) return 'hôm nay';
  if (todayDayOfYear + 1 === targetDayOfYear) return 'ngày mai';
  return '(tên thứ)';
}

export function formatSecond(second: number) {
  const h = Math.floor(second / 3600);
  const m = Math.floor((second % 3600) / 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function parseHHMM(value: string) {
  const [h, m] = value.split(':').map(Number);
  return h * 3600 + m * 60;
}

/**
 * Bản gốc đổi "giây trong ngày" ra thời điểm bằng startOfDay().addSeconds(s). Ngày đổi giờ
 * mùa hè chỉ có 23 giờ, nên 02:30 cộng từ nửa đêm thành 03:30 giờ treo tường.
 * Hàm này tái hiện phép tính đó bằng Intl để demo cho thấy độ lệch.
 */
export function wallClockAfterAddingSeconds(midnightUtc: Date, seconds: number, timeZone: string) {
  const at = new Date(midnightUtc.getTime() + seconds * 1000);
  return new Intl.DateTimeFormat('vi-VN', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at);
}

/** Mốc UTC của 0:00 giờ treo tường ngày `date` ở múi `timeZone` (dò theo offset, đủ cho demo). */
export function zonedMidnight(date: string, timeZone: string) {
  const [y, m, d] = date.split('-').map(Number);
  let guess = Date.UTC(y, m - 1, d);
  for (let i = 0; i < 3; i++) {
    const z = zonedNow(new Date(guess), timeZone);
    const diffDays = (Date.UTC(y, m - 1, d) - Date.parse(`${z.date}T00:00:00Z`)) / 86_400_000;
    guess += diffDays * 86_400_000 - z.secondOfDay * 1000;
  }
  return new Date(guess);
}
