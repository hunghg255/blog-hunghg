/**
 * Lịch chọn khoảng ngày (ý tưởng từ AbstractCalendar.react của Facebook).
 *
 * - Ngày được biểu diễn bằng "số ngày kể từ 1970-01-01" (epoch day): cộng trừ ngày chỉ là
 *   cộng trừ số nguyên, không dính múi giờ hay giờ mùa hè như khi dùng Date.
 * - Mỗi ô có hai thuộc tính: vị trí trong khoảng chọn (start/mid/end) và vị trí trong hàng
 *   (start/mid/end/only). CSS dựa vào cặp này để bo góc dải chọn ở mép mỗi hàng.
 * - Đi phím đủ bộ: mũi tên (đảo trái/phải khi RTL), Home/End, PageUp/PageDown (±1 tháng,
 *   giữ Ctrl/Alt thì ±12 tháng).
 */

/** Số ngày kể từ 1970-01-01 (UTC). */
export type EpochDay = number;

const MS_PER_DAY = 86_400_000;

export function fromYMD(year: number, month: number, day: number): EpochDay {
  // month: 1–12, giống LocalDate của Facebook (Date.UTC nhận 0–11)
  return Math.round(Date.UTC(year, month - 1, day) / MS_PER_DAY);
}

export function toYMD(day: EpochDay) {
  const d = new Date(day * MS_PER_DAY);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/** 0 = Chủ nhật … 6 = thứ Bảy (cùng quy ước với Date#getDay). 1970-01-01 là thứ Năm. */
export function dayOfWeek(day: EpochDay) {
  return (((day + 4) % 7) + 7) % 7;
}

export function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function addMonths(day: EpochDay, delta: number): EpochDay {
  const { year, month, day: dom } = toYMD(day);
  const index = year * 12 + (month - 1) + delta;
  const y = Math.floor(index / 12);
  const m = (index % 12) + 1;
  // 31/1 + 1 tháng = 28 hoặc 29/2, không nhảy sang tháng 3
  return fromYMD(y, m, Math.min(dom, daysInMonth(y, m)));
}

/** Số tuần ISO 8601: tuần bắt đầu từ thứ Hai, tuần 1 là tuần chứa thứ Năm đầu tiên của năm. */
export function isoWeek(day: EpochDay) {
  const thursday = day - ((dayOfWeek(day) + 6) % 7) + 3;
  const { year } = toYMD(thursday);
  return Math.floor((thursday - fromYMD(year, 1, 1)) / 7) + 1;
}

export type RangePosition = 'start' | 'mid' | 'end' | null;
export type RowPosition = 'start' | 'mid' | 'end' | 'only' | null;

export interface DayCell {
  day: EpochDay;
  dayOfMonth: number;
  isRowStart: boolean;
  isRowEnd: boolean;
  rangePosition: RangePosition;
  rowPosition: RowPosition;
}

export type Cell = DayCell | null; // null = ô đệm

export interface MonthGrid {
  rows: Cell[][];
  /** số tuần ISO của từng hàng (tính từ thứ Hai của hàng) */
  weekNumbers: number[];
}

export interface GridOptions {
  year: number;
  month: number; // 1–12
  /** ngày đầu tuần, theo quy ước Date#getDay: 1 = thứ Hai, 0 = Chủ nhật */
  weekStart: number;
  range?: { a: EpochDay; b: EpochDay } | null;
  /** luôn vẽ đủ 6 hàng để chiều cao không nhảy khi đổi tháng */
  fixedRows?: boolean;
}

export function getRangePosition(day: EpochDay, min: EpochDay, max: EpochDay): RangePosition {
  if (day === min) return 'start';
  if (day === max) return 'end';
  if (day > min && day < max) return 'mid';
  return null;
}

/**
 * Vị trí trong hàng dùng để bo góc. Cùng bảng chân trị với bản gốc:
 * - khoảng chỉ có 1 ngày → only
 * - ô cuối hàng: only nếu nó cũng là đầu hàng hoặc là ngày bắt đầu khoảng, ngược lại end
 * - ô đầu hàng: only nếu nó là ngày kết thúc khoảng, ngược lại start
 */
export function getRowPosition(
  isRowStart: boolean,
  isRowEnd: boolean,
  rangePosition: RangePosition,
  hasDuration: boolean,
): RowPosition {
  if (rangePosition === null) return null;
  if (!hasDuration) return 'only';
  if (isRowEnd) return isRowStart || rangePosition === 'start' ? 'only' : 'end';
  if (isRowStart) return rangePosition === 'end' ? 'only' : 'start';
  return 'mid';
}

/** Mép nào của ô được bo tròn, giống cách CSS của bản gốc ghép class dayRangeLeft/Right/Only. */
export function roundedEdges(cell: DayCell) {
  const { rangePosition: range, rowPosition: row } = cell;
  return {
    left: range === 'start' || (range === 'mid' && row === 'start'),
    right: range === 'end' || (range === 'mid' && row === 'end'),
    only: row === 'only',
  };
}

export function buildMonthGrid({ year, month, weekStart, range = null, fixedRows = true }: GridOptions): MonthGrid {
  const first = fromYMD(year, month, 1);
  const total = daysInMonth(year, month);
  // chọn ngược chiều (bấm ngày sau trước) vẫn đúng nhờ min/max
  const min = range ? Math.min(range.a, range.b) : 0;
  const max = range ? Math.max(range.a, range.b) : 0;
  const hasDuration = !!range && min !== max;

  const padding = (dayOfWeek(first) - weekStart + 7) % 7;
  const rows: Cell[][] = [];
  let row: Cell[] = Array.from({ length: padding }, () => null);

  for (let i = 0; i < total; i++) {
    const day = first + i;
    const column = row.length;
    // ngày 1 và ngày cuối tháng cũng tính là mép hàng: dải chọn kéo qua tháng sau bị cắt ở đó
    const isRowStart = column === 0 || i === 0;
    const isRowEnd = column === 6 || i === total - 1;
    const rangePosition = range ? getRangePosition(day, min, max) : null;
    row.push({
      day,
      dayOfMonth: i + 1,
      isRowStart,
      isRowEnd,
      rangePosition,
      rowPosition: getRowPosition(isRowStart, isRowEnd, rangePosition, hasDuration),
    });
    if (row.length === 7) {
      rows.push(row);
      row = [];
    }
  }
  if (row.length) rows.push([...row, ...Array.from({ length: 7 - row.length }, () => null)]);
  while (fixedRows && rows.length < 6) rows.push(Array.from({ length: 7 }, () => null));

  const weekNumbers = rows.map((r, index) => {
    // ngày ở cột 0 của hàng (kể cả khi là ô đệm) = ngày đầu tháng lùi về đầu tuần + 7 * index
    const rowStart = first - padding + index * 7;
    // hàng bắt đầu từ Chủ nhật: lấy thứ Hai ngay sau đó, vì 6/7 ngày của hàng thuộc tuần ISO đó
    const monday = rowStart + ((8 - dayOfWeek(rowStart)) % 7);
    return r.some(Boolean) ? isoWeek(monday) : 0;
  });

  return { rows, weekNumbers };
}

/**
 * Cách Facebook tính số tuần cho một hàng: lấy NGÀY CUỐI HÀNG, nếu là Chủ nhật thì +1 ngày
 * rồi mới hỏi số tuần ISO. Đúng khi tuần bắt đầu từ Chủ nhật (ngày cuối hàng là thứ Bảy),
 * nhưng lệch +1 khi tuần bắt đầu từ thứ Hai (ngày cuối hàng là Chủ nhật → nhảy sang tuần sau).
 */
export function fbStyleWeekNumber(rowEnd: EpochDay) {
  const day = dayOfWeek(rowEnd) === 0 ? rowEnd + 1 : rowEnd;
  return isoWeek(day);
}

export interface CursorKey {
  key: string;
  ctrlKey?: boolean;
  altKey?: boolean;
}

/** Ngày con trỏ mới sau một phím, hoặc null nếu phím không liên quan. */
export function moveCursor(cursor: EpochDay, { key, ctrlKey, altKey }: CursorKey, rtl = false): EpochDay | null {
  const { year, month } = toYMD(cursor);
  switch (key) {
    case 'ArrowLeft':
      return cursor + (rtl ? 1 : -1);
    case 'ArrowRight':
      return cursor + (rtl ? -1 : 1);
    case 'ArrowUp':
      return cursor - 7;
    case 'ArrowDown':
      return cursor + 7;
    case 'Home':
      return fromYMD(year, month, 1);
    case 'End':
      return fromYMD(year, month, daysInMonth(year, month));
    case 'PageUp':
      return addMonths(cursor, ctrlKey || altKey ? -12 : -1);
    case 'PageDown':
      return addMonths(cursor, ctrlKey || altKey ? 12 : 1);
    default:
      return null;
  }
}
