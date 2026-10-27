/**
 * Đọc khoảng thời gian từ API/cấu hình/người dùng: 86400000, "45min", "2h", "1h30m",
 * "2 giờ 15 phút"… (ý tưởng từ lib/weirdTime.ts của Elastic Cloud, đã sửa các trường hợp
 * bản gốc hiểu sai như "500ms" thành 500 phút).
 */

const MINUTE = 60_000;
const UNIT_MS: Record<string, number> = {};
const aliases: Array<[number, string[]]> = [
  [1, ['ms', 'msec', 'millisecond', 'milliseconds', 'mili giây']],
  [1000, ['s', 'sec', 'secs', 'second', 'seconds', 'giây']],
  [MINUTE, ['m', 'min', 'mins', 'minute', 'minutes', 'phút']],
  [60 * MINUTE, ['h', 'hr', 'hrs', 'hour', 'hours', 'giờ', 'tiếng']],
  [24 * 60 * MINUTE, ['d', 'day', 'days', 'ngày']],
  [7 * 24 * 60 * MINUTE, ['w', 'week', 'weeks', 'tuần']],
];
for (const [ms, names] of aliases) for (const name of names) UNIT_MS[name] = ms;

export type DurationResult = { ok: true; ms: number } | { ok: false; reason: string };

export interface DurationOptions {
  /** giá trị khi rỗng hoặc "default" (Elastic: 30 phút) */
  defaultMs?: number;
  /** đơn vị khi chỉ có số: Elastic coi số thuần là mili giây, chuỗi số thuần là giây */
  bareNumberUnit?: 'ms' | 's';
}

// một cặp "số + đơn vị", đơn vị có thể có dấu cách bên trong ("mili giây")
const PART = /(\d+(?:[.,]\d+)?)\s*(mili giây|[\p{L}]*)/gu;

export function parseDuration(
  input: number | string | null | undefined,
  { defaultMs = 30 * MINUTE, bareNumberUnit = 's' }: DurationOptions = {},
): DurationResult {
  if (input == null || input === '' || input === 'default') return { ok: true, ms: defaultMs };
  if (typeof input === 'number') {
    return Number.isFinite(input) && input >= 0 ? { ok: true, ms: input } : { ok: false, reason: 'số không hợp lệ' };
  }

  const text = input.trim().toLocaleLowerCase('vi');
  let total = 0;
  let consumed = '';
  for (const [whole, rawValue, rawUnit] of text.matchAll(PART)) {
    const unit = rawUnit || bareNumberUnit;
    const factor = UNIT_MS[unit];
    // đơn vị lạ thì báo lỗi, KHÔNG âm thầm coi là giây như bản gốc
    if (factor === undefined) return { ok: false, reason: `không hiểu đơn vị "${rawUnit}"` };
    total += parseFloat(rawValue.replace(',', '.')) * factor;
    consumed += whole;
  }
  // mọi ký tự (trừ khoảng trắng) phải thuộc một cặp số + đơn vị: "abc", "h", "2h nữa" đều bị từ chối
  if (!consumed || consumed.replace(/\s/g, '') !== text.replace(/\s/g, '')) {
    return { ok: false, reason: 'không đọc được' };
  }
  return { ok: true, ms: Math.round(total) };
}

/** 5_400_000 -> "1h 30m" */
export function formatDuration(ms: number): string {
  const parts: string[] = [];
  let rest = ms;
  for (const [unit, size] of [['d', 24 * 60 * MINUTE], ['h', 60 * MINUTE], ['m', MINUTE], ['s', 1000]] as const) {
    if (rest >= size) {
      parts.push(`${Math.floor(rest / size)}${unit}`);
      rest %= size;
    }
  }
  if (rest || !parts.length) parts.push(`${rest}ms`);
  return parts.join(' ');
}
