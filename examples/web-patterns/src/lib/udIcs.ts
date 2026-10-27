/**
 * Sinh file .ics (iCalendar, RFC 5545) cho lịch nhắc học, ý tưởng từ
 * learning-calendar-reminders của Udemy, viết lại với các sửa lỗi:
 * - VTIMEZONE cho múi giờ BẤT KỲ (không chỉ múi giờ của máy), có quy luật RRULE
 *   nên sự kiện lặp nhiều năm vẫn đúng giờ, và vẫn hợp lệ với múi giờ không có giờ mùa hè.
 * - Dòng kết thúc bằng CRLF, gấp dòng ở 75 octet, escape TEXT, không có dòng trống.
 * - Tên file giữ được tiếng Việt (bỏ dấu thay vì xoá cả chữ).
 */

// ---- Offset của một múi giờ tại một thời điểm ----

const dtfCache = new Map<string, Intl.DateTimeFormat>();

function wallFormatter(timeZone: string) {
  let dtf = dtfCache.get(timeZone);
  if (!dtf) {
    dtf = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    dtfCache.set(timeZone, dtf);
  }
  return dtf;
}

/** Giờ treo tường (wall time) của `epochMs` tại `timeZone`. */
export function wallParts(timeZone: string, epochMs: number) {
  const parts: Record<string, number> = {};
  for (const p of wallFormatter(timeZone).formatToParts(epochMs)) {
    if (p.type !== 'literal') parts[p.type] = Number(p.value);
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

/** Offset (phút, dương ở phía đông UTC) của `timeZone` tại `epochMs`. VD Hà Nội = 420. */
export function tzOffsetMinutes(timeZone: string, epochMs: number) {
  const w = wallParts(timeZone, epochMs);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return Math.round((asUtc - Math.floor(epochMs / 1000) * 1000) / 60000);
}

/**
 * Đổi giờ treo tường ở `timeZone` sang epoch. Giờ bị lặp (vặn lùi) lấy lần đầu; giờ không tồn tại
 * (vặn lên, VD 02:30 ở Los Angeles ngày đổi giờ) bị đẩy về sau thành 03:30, giống Temporal 'compatible'.
 */
export function wallToEpoch(timeZone: string, y: number, mo: number, d: number, h = 0, mi = 0) {
  const naive = Date.UTC(y, mo - 1, d, h, mi);
  const g1 = naive - tzOffsetMinutes(timeZone, naive) * 60000;
  const g2 = naive - tzOffsetMinutes(timeZone, g1) * 60000;
  const w = wallParts(timeZone, g2);
  const ok = w.year === y && w.month === mo && w.day === d && w.hour === h && w.minute === mi;
  return ok ? g2 : Math.max(g1, g2);
}

// ---- Tìm các lần đổi giờ trong một năm ----

export interface Transition {
  /** thời điểm đổi giờ (epoch ms) */
  at: number;
  from: number;
  to: number;
}

const WEEK = 7 * 24 * 3600 * 1000;

/** Quét từng tuần, thấy offset đổi thì chia đôi khoảng tới độ chính xác 1 phút. */
export function findTransitions(timeZone: string, year: number): Transition[] {
  const result: Transition[] = [];
  const end = Date.UTC(year + 1, 0, 1);
  let t = Date.UTC(year, 0, 1);
  let off = tzOffsetMinutes(timeZone, t);
  while (t < end) {
    const next = Math.min(t + WEEK, end);
    const nextOff = tzOffsetMinutes(timeZone, next);
    if (nextOff !== off) {
      let lo = t;
      let hi = next;
      while (hi - lo > 60000) {
        const mid = Math.floor((lo + hi) / 2 / 60000) * 60000;
        if (tzOffsetMinutes(timeZone, mid) === off) lo = mid;
        else hi = mid;
      }
      result.push({ at: hi, from: off, to: nextOff });
    }
    t = next;
    off = nextOff;
  }
  return result;
}

// ---- Định dạng ----

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/** '+0700', '-0330' */
export function formatOffset(minutes: number) {
  const sign = minutes < 0 ? '-' : '+';
  const a = Math.abs(minutes);
  return `${sign}${pad(Math.floor(a / 60))}${pad(a % 60)}`;
}

/** Giờ treo tường dạng iCalendar: 20261102T200000 */
export function formatLocal(w: { year: number; month: number; day: number; hour: number; minute: number }) {
  return `${w.year}${pad(w.month)}${pad(w.day)}T${pad(w.hour)}${pad(w.minute)}00`;
}

/** Giờ UTC dạng iCalendar: 20261102T130000Z */
export function formatUtc(epochMs: number) {
  return `${new Date(epochMs).toISOString().slice(0, 19).replace(/[-:]/g, '')}Z`;
}

function tzName(timeZone: string, epochMs: number) {
  const part = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'short' })
    .formatToParts(epochMs)
    .find((p) => p.type === 'timeZoneName');
  return part?.value ?? timeZone;
}

const WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

/** Lần đổi giờ dạng "Chủ nhật thứ 2 của tháng 3, lúc 02:00 (giờ cũ)". */
function describeTransition(timeZone: string, tr: Transition) {
  // giờ treo tường tính theo offset CŨ, đúng như RFC 5545 yêu cầu cho DTSTART của observance
  const w = wallParts('UTC', tr.at + tr.from * 60000);
  const weekday = new Date(Date.UTC(w.year, w.month - 1, w.day)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(w.year, w.month, 0)).getUTCDate();
  return {
    w,
    month: w.month,
    weekday,
    nth: Math.ceil(w.day / 7),
    isLast: w.day + 7 > daysInMonth,
    time: w.hour * 60 + w.minute,
    name: tzName(timeZone, tr.at),
  };
}

type Kind = 'DAYLIGHT' | 'STANDARD';

/**
 * Các dòng của VTIMEZONE. Thử suy ra quy luật hằng năm (BYMONTH + BYDAY) từ `years` năm;
 * khớp được thì ghi 1 observance có RRULE (đúng cho mọi năm sau), không thì liệt kê từng năm.
 */
export function vtimezoneLines(timeZone: string, fromYear: number, years = 6): string[] {
  const all: Transition[] = [];
  for (let y = fromYear; y < fromYear + years; y++) all.push(...findTransitions(timeZone, y));

  const lines = ['BEGIN:VTIMEZONE', `TZID:${timeZone}`];

  if (all.length === 0) {
    // Không có giờ mùa hè (VD Asia/Ho_Chi_Minh). RFC 5545 vẫn bắt buộc có ít nhất 1 STANDARD.
    const off = tzOffsetMinutes(timeZone, Date.UTC(fromYear, 0, 1));
    lines.push(
      'BEGIN:STANDARD',
      'DTSTART:19700101T000000',
      `TZOFFSETFROM:${formatOffset(off)}`,
      `TZOFFSETTO:${formatOffset(off)}`,
      `TZNAME:${tzName(timeZone, Date.UTC(fromYear, 0, 1))}`,
      'END:STANDARD',
      'END:VTIMEZONE',
    );
    return lines;
  }

  for (const kind of ['STANDARD', 'DAYLIGHT'] as Kind[]) {
    const group = all.filter((t) => (kind === 'DAYLIGHT' ? t.to > t.from : t.to < t.from));
    if (group.length === 0) continue;
    const ds = group.map((t) => describeTransition(timeZone, t));
    const first = ds[0];
    const sameShape = ds.every(
      (d, i) =>
        d.month === first.month &&
        d.weekday === first.weekday &&
        d.time === first.time &&
        group[i].from === group[0].from &&
        group[i].to === group[0].to,
    );
    const nth = ds.every((d) => d.isLast) ? -1 : ds.every((d) => d.nth === first.nth) ? first.nth : 0;

    if (sameShape && nth !== 0 && group.length === years) {
      lines.push(
        `BEGIN:${kind}`,
        `DTSTART:${formatLocal(first.w)}`,
        `RRULE:FREQ=YEARLY;BYMONTH=${first.month};BYDAY=${nth}${WEEKDAYS[first.weekday]}`,
        `TZOFFSETFROM:${formatOffset(group[0].from)}`,
        `TZOFFSETTO:${formatOffset(group[0].to)}`,
        `TZNAME:${first.name}`,
        `END:${kind}`,
      );
    } else {
      // Quy luật không ổn định (luật thay đổi giữa các năm): liệt kê từng lần đổi giờ.
      group.forEach((t, i) => {
        lines.push(
          `BEGIN:${kind}`,
          `DTSTART:${formatLocal(ds[i].w)}`,
          `TZOFFSETFROM:${formatOffset(t.from)}`,
          `TZOFFSETTO:${formatOffset(t.to)}`,
          `TZNAME:${ds[i].name}`,
          `END:${kind}`,
        );
      });
    }
  }
  lines.push('END:VTIMEZONE');
  return lines;
}

// ---- TEXT: escape, gấp dòng ----

/** RFC 5545 §3.3.11: escape \ ; , và xuống dòng. */
export function escapeText(s: string) {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

const encoder = new TextEncoder();

/** RFC 5545 §3.1: mỗi dòng tối đa 75 octet; dòng tiếp theo bắt đầu bằng 1 dấu cách. Không cắt giữa ký tự UTF-8. */
export function foldLine(line: string): string {
  if (encoder.encode(line).length <= 75) return line;
  const out: string[] = [];
  let current = '';
  let bytes = 0;
  let limit = 75;
  for (const ch of line) {
    const n = encoder.encode(ch).length;
    if (bytes + n > limit) {
      out.push(current);
      current = '';
      bytes = 0;
      limit = 74; // dòng sau còn 74 vì đã tốn 1 octet cho dấu cách đầu dòng
    }
    current += ch;
    bytes += n;
  }
  out.push(current);
  return out.join('\r\n ');
}

// ---- Sự kiện ----

export interface IcsReminder {
  /** id duy nhất, giữ nguyên qua các lần cập nhật */
  uid: string;
  title: string;
  description?: string;
  url?: string;
  timeZone: string;
  /** ngày bắt đầu theo giờ treo tường của timeZone */
  start: { year: number; month: number; day: number; hour: number; minute: number };
  durationMinutes: number;
  repeat?: { freq: 'DAILY' | 'WEEKLY'; byDay?: string[]; until?: { year: number; month: number; day: number } };
  alarmMinutesBefore?: number;
  /** tăng mỗi lần cập nhật để lịch biết bản nào mới hơn */
  sequence: number;
  cancelled?: boolean;
}

/**
 * Tạo nội dung file .ics. Huỷ dùng METHOD:CANCEL + STATUS:CANCELLED (RFC 5546),
 * cùng UID và SEQUENCE lớn hơn để lịch thay thế sự kiện cũ.
 */
export function buildIcs(r: IcsReminder, now = Date.now()): string {
  const startEpoch = wallToEpoch(r.timeZone, r.start.year, r.start.month, r.start.day, r.start.hour, r.start.minute);
  const end = wallParts(r.timeZone, startEpoch + r.durationMinutes * 60000);
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//blog.hunghg.me//learning-reminder//VI',
    'CALSCALE:GREGORIAN',
    `METHOD:${r.cancelled ? 'CANCEL' : 'PUBLISH'}`,
    ...vtimezoneLines(r.timeZone, r.start.year),
    'BEGIN:VEVENT',
    `UID:${r.uid}`,
    `SEQUENCE:${r.sequence}`,
    `DTSTAMP:${formatUtc(now)}`,
    `DTSTART;TZID=${r.timeZone}:${formatLocal(r.start)}`,
    `DTEND;TZID=${r.timeZone}:${formatLocal(end)}`,
    `SUMMARY:${escapeText(r.title)}`,
  ];
  if (r.repeat) {
    let rule = `RRULE:FREQ=${r.repeat.freq}`;
    if (r.repeat.byDay?.length) rule += `;BYDAY=${r.repeat.byDay.join(',')}`;
    if (r.repeat.until) {
      // DTSTART có TZID thì UNTIL BẮT BUỘC là giờ UTC (RFC 5545 §3.3.10). Lấy cuối ngày theo giờ địa phương.
      const u = r.repeat.until;
      rule += `;UNTIL=${formatUtc(wallToEpoch(r.timeZone, u.year, u.month, u.day, 23, 59))}`;
    }
    lines.push(rule);
  }
  const desc = [r.description, r.url].filter(Boolean).join('\n');
  if (desc) lines.push(`DESCRIPTION:${escapeText(desc)}`);
  if (r.url) lines.push(`URL:${r.url}`);
  if (r.cancelled) lines.push('STATUS:CANCELLED');
  if (r.alarmMinutesBefore) {
    lines.push(
      'BEGIN:VALARM',
      `TRIGGER:-PT${r.alarmMinutesBefore}M`,
      'ACTION:DISPLAY',
      `DESCRIPTION:${escapeText(r.title)}`,
      'END:VALARM',
    );
  }
  lines.push('END:VEVENT', 'END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}

/** Tên file từ tiêu đề: bỏ dấu (giữ chữ), đ → d, ký tự lạ thành '-'. Không bao giờ rỗng. */
export function icsFileName(title: string) {
  const slug = title
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${slug || 'nhac-hoc'}.ics`;
}

/** Tải file bằng Blob URL (không nhét cả file vào data: URI) rồi thu hồi URL. */
export function downloadIcs(content: string, fileName: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/calendar;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
