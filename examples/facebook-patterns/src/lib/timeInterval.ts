/**
 * Khoảng thời gian nửa mở [start, end) và phép đo theo lịch (ý tưởng từ TimeInterval của Facebook).
 *
 * Đơn vị là mili giây UTC để ví dụ gọn; bản gốc dùng giây Unix + timezoneID và đo ngày/tháng
 * theo lịch của múi giờ đó. Muốn đo theo múi giờ khác thì đổi `addMonthsUTC` sang hàm cộng tháng
 * theo múi giờ (ví dụ Temporal.ZonedDateTime.add).
 */

export class Interval {
  constructor(
    readonly start: number,
    readonly end: number,
  ) {
    if (!(start <= end)) throw new RangeError(`Interval: start (${start}) phải <= end (${end})`);
  }

  static of(a: Date | number, b: Date | number) {
    return new Interval(+a, +b);
  }

  get length() {
    return this.end - this.start;
  }

  contains(t: number) {
    return this.start <= t && t < this.end;
  }

  /** dính mép: [0,5) và [5,9) */
  abuts(o: Interval) {
    return Math.max(this.start, o.start) === Math.min(this.end, o.end);
  }

  /** chồng lên nhau thật sự (dính mép không tính) */
  overlaps(o: Interval) {
    return Math.max(this.start, o.start) < Math.min(this.end, o.end);
  }

  /** phần chung; dính mép trả về khoảng rỗng [5,5), rời nhau trả về null */
  intersect(o: Interval): Interval | null {
    const s = Math.max(this.start, o.start);
    const e = Math.min(this.end, o.end);
    return s <= e ? new Interval(s, e) : null;
  }

  /** khoảng trống giữa hai khoảng rời nhau, null nếu chúng chạm hoặc chồng nhau */
  gap(o: Interval): Interval | null {
    const s = Math.min(this.end, o.end);
    const e = Math.max(this.start, o.start);
    return s < e ? new Interval(s, e) : null;
  }

  /** hợp, chỉ khi kết quả vẫn liền một khúc (chồng hoặc dính mép) */
  union(o: Interval): Interval | null {
    return this.intersect(o) ? new Interval(Math.min(this.start, o.start), Math.max(this.end, o.end)) : null;
  }
}

/** Gộp danh sách khoảng: sắp theo start rồi quét một lượt. */
export function mergeIntervals(list: Interval[]): Interval[] {
  const sorted = [...list].sort((a, b) => a.start - b.start);
  const out: Interval[] = [];
  for (const cur of sorted) {
    const last = out[out.length - 1];
    const merged = last?.union(cur);
    if (merged) out[out.length - 1] = merged;
    else out.push(cur);
  }
  return out;
}

const DAY = 86_400_000;

/** Cộng tháng, kẹp về ngày cuối tháng: 31/1 + 1 tháng = 28/2 (hoặc 29/2). */
export function addMonthsUTC(t: number, months: number): number {
  const d = new Date(t);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const day = Math.min(d.getUTCDate(), lastDay);
  return Date.UTC(y, m, day, d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds());
}

/**
 * Số tháng TRỌN giữa start và end. Ước lượng bằng hiệu năm/tháng, rồi lùi tối đa 2 bước
 * cho tới khi start + n tháng không vượt end (cùng cách bản gốc làm).
 */
export function wholeMonths(iv: Interval): number {
  const a = new Date(iv.start);
  const b = new Date(iv.end);
  const guess = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
  for (let n = guess; n > Math.max(0, guess - 2); n--) {
    if (addMonthsUTC(iv.start, n) <= iv.end) return n;
  }
  return Math.max(0, guess - 2);
}

export interface Period {
  years: number;
  months: number;
  days: number;
}

/**
 * "Bao lâu" theo lịch. Luôn cộng từ mốc start (không cộng dồn từng tháng một),
 * vì 31/1 +1 tháng +1 tháng = 28/3 còn 31/1 + 2 tháng = 31/3.
 */
export function toPeriod(iv: Interval): Period {
  const total = wholeMonths(iv);
  const anchor = addMonthsUTC(iv.start, total);
  return { years: Math.floor(total / 12), months: total % 12, days: Math.floor((iv.end - anchor) / DAY) };
}

/** Cách hay gặp mà sai: coi mọi tháng dài 30 ngày. */
export function naivePeriod(iv: Interval): Period {
  const days = Math.floor(iv.length / DAY);
  const months = Math.floor(days / 30);
  return { years: Math.floor(months / 12), months: months % 12, days: days - months * 30 };
}
