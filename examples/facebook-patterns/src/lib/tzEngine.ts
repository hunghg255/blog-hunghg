/**
 * Engine múi giờ nhỏ chạy trên client (ý tưởng từ TimezoneDatabaseUtil, TimezoneUtil và CometTimezoneUpdater của Facebook).
 *
 * Luật DST viết theo cú pháp tzdata: "2005 2012 Apr Fri<=1 2:00 1:00" nghĩa là từ 2005 tới 2012,
 * tháng 4, thứ Sáu cuối cùng trên hoặc trước ngày 1, lúc 2:00 giờ địa phương, cộng thêm 1 giờ.
 *
 * Khác bản gốc: hàm tính ngày trả về NGÀY ĐẦY ĐỦ (năm, tháng, ngày) thay vì chỉ "ngày trong tháng",
 * nên "Fri<=1" rơi sang tháng trước vẫn đúng. Bản gốc chỉ sửa tháng cho dạng ">=".
 * Mỗi múi giờ chỉ có một "era" (một offset chuẩn) để ví dụ gọn.
 */

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const mod = (a: number, n: number) => ((a % n) + n) % n;

/** "+5:30" → 19800 giây; "-3" → -10800; "2:00" → 7200 */
export function parseOffset(text: string): number {
  const m = /^([+-]?)(\d+)(?::(\d+))?(?::(\d+))?$/.exec(text.trim());
  if (!m) throw new SyntaxError(`Offset không hợp lệ: ${text}`);
  const sign = m[1] === '-' ? -1 : 1;
  return sign * (+m[2] * 3600 + +(m[3] ?? 0) * 60 + +(m[4] ?? 0));
}

export type DayExpr =
  | { kind: 'dom'; day: number }
  | { kind: 'last'; dow: number }
  | { kind: '>=' | '<='; dow: number; day: number };

export function parseDayExpr(text: string): DayExpr {
  let m: RegExpExecArray | null;
  if ((m = /^(\w{3})(>=|<=)(\d+)$/.exec(text)) && DAYS.includes(m[1])) {
    return { kind: m[2] as '>=' | '<=', dow: DAYS.indexOf(m[1]), day: +m[3] };
  }
  if ((m = /^last(\w{3})$/.exec(text)) && DAYS.includes(m[1])) return { kind: 'last', dow: DAYS.indexOf(m[1]) };
  if (/^\d+$/.test(text)) return { kind: 'dom', day: +text };
  throw new SyntaxError(`Biểu thức ngày không hợp lệ: ${text}`);
}

export interface YMD {
  year: number;
  month: number; // 1–12
  day: number;
}

const dowOf = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d)).getUTCDay();

/** Ngày thật của biểu thức trong (năm, tháng). Kết quả có thể nằm ở tháng trước/sau. */
export function resolveDay(expr: DayExpr, year: number, month: number): YMD {
  let day: number;
  switch (expr.kind) {
    case 'dom':
      day = expr.day;
      break;
    case 'last': {
      const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
      day = lastDay - mod(dowOf(year, month, lastDay) - expr.dow, 7);
      break;
    }
    case '>=':
      day = expr.day + mod(expr.dow - dowOf(year, month, expr.day), 7);
      break;
    case '<=':
      day = expr.day - mod(dowOf(year, month, expr.day) - expr.dow, 7);
      break;
  }
  // Date.UTC tự tràn: ngày 0 = cuối tháng trước, ngày 32 = đầu tháng sau
  const d = new Date(Date.UTC(year, month - 1, day));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

export type DayResolver = (expr: DayExpr, year: number, month: number) => YMD;

export interface Rule {
  from: number;
  to: number;
  month: number;
  day: DayExpr;
  /** giây kể từ nửa đêm */
  at: number;
  /** 'w' giờ địa phương đang chạy, 's' giờ chuẩn (bỏ DST), 'u' UTC */
  atType: 'w' | 's' | 'u';
  save: number;
}

/** Đọc một dòng luật kiểu tzdata: "FROM TO MON DAY AT SAVE" (TO có thể là only/max). */
export function rule(line: string): Rule {
  const [from, to, mon, day, at, save] = line.trim().split(/\s+/);
  const atType = /[us]$/.test(at) ? (at.slice(-1) as 'u' | 's') : 'w';
  return {
    from: +from,
    to: to === 'only' ? +from : to === 'max' ? 9999 : +to,
    month: MONTHS.indexOf(mon) + 1,
    day: parseDayExpr(day),
    at: parseOffset(at.replace(/[usw]$/, '')),
    atType,
    save: parseOffset(save),
  };
}

export interface Zone {
  name: string;
  std: number; // offset chuẩn, giây
  rules: Rule[];
}

export interface Transition {
  at: number; // ms UTC
  offset: number; // giây, sau chuyển
  save: number;
  local: YMD;
}

/** Mọi lần chuyển giờ trong [fromYear, toYear], tính tuần tự để biết DST đang bật trước mỗi lần. */
export function transitions(zone: Zone, fromYear: number, toYear: number, resolve: DayResolver = resolveDay) {
  const items: { local: YMD; localMs: number; r: Rule }[] = [];
  for (let y = fromYear - 1; y <= toYear; y++) {
    for (const r of zone.rules) {
      if (y < r.from || y > r.to) continue;
      const local = resolve(r.day, y, r.month);
      items.push({ local, localMs: Date.UTC(local.year, local.month - 1, local.day) + r.at * 1000, r });
    }
  }
  items.sort((a, b) => a.localMs - b.localMs);
  const out: Transition[] = [];
  let save = 0;
  for (const { local, localMs, r } of items) {
    const shift = r.atType === 'u' ? 0 : r.atType === 's' ? zone.std : zone.std + save;
    const at = localMs - shift * 1000;
    save = r.save;
    if (local.year >= fromYear) out.push({ at, offset: zone.std + save, save, local });
  }
  return out;
}

/** Offset (giây) đang áp dụng tại thời điểm UTC `ms`. */
export function offsetAt(zone: Zone, ms: number, resolve: DayResolver = resolveDay): number {
  const y = new Date(ms).getUTCFullYear();
  const list = transitions(zone, y - 1, y, resolve);
  let offset = zone.std;
  for (const t of list) if (t.at <= ms) offset = t.offset;
  return offset;
}

// ---------------- dữ liệu mẫu (rút gọn từ tzdata) ----------------

const ISRAEL_END: [number, string, string][] = [
  [2005, 'Oct', '9'],
  [2006, 'Oct', '1'],
  [2007, 'Sep', '16'],
  [2008, 'Oct', '5'],
  [2009, 'Sep', '27'],
  [2010, 'Sep', '12'],
  [2011, 'Oct', '2'],
  [2012, 'Sep', '23'],
];

export const ZONES: Record<string, Zone> = {
  'Asia/Jerusalem': {
    name: 'Asia/Jerusalem',
    std: 7200,
    rules: [
      rule('2005 2012 Apr Fri<=1 2:00 1:00'),
      ...ISRAEL_END.map(([y, m, d]) => rule(`${y} only ${m} ${d} 2:00 0`)),
      rule('2013 max Mar Fri>=23 2:00 1:00'),
      rule('2013 max Oct lastSun 2:00 0'),
    ],
  },
  'America/New_York': {
    name: 'America/New_York',
    std: -18000,
    rules: [rule('2007 max Mar Sun>=8 2:00 1:00'), rule('2007 max Nov Sun>=1 2:00 0')],
  },
  'Europe/Berlin': {
    name: 'Europe/Berlin',
    std: 3600,
    rules: [rule('1996 max Mar lastSun 1:00u 1:00'), rule('1996 max Oct lastSun 1:00u 0')],
  },
  'Australia/Sydney': {
    name: 'Australia/Sydney',
    std: 36000,
    rules: [rule('2008 max Apr Sun>=1 2:00s 0'), rule('2008 max Oct Sun>=1 2:00s 1:00')],
  },
  'Asia/Ho_Chi_Minh': { name: 'Asia/Ho_Chi_Minh', std: 25200, rules: [] },
};

// ---------------- so với trình duyệt ----------------

/** Offset (giây) theo dữ liệu tz có sẵn trong trình duyệt, để đối chiếu. */
const formatters = new Map<string, Intl.DateTimeFormat>();
export function intlOffset(timeZone: string, ms: number): number {
  let f = formatters.get(timeZone);
  if (!f) formatters.set(timeZone, (f = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })));
  const name = f
    .formatToParts(ms)
    .find((p) => p.type === 'timeZoneName')?.value;
  const m = /GMT([+-])(\d{2}):(\d{2})/.exec(name ?? '');
  return m ? (m[1] === '-' ? -1 : 1) * (+m[2] * 3600 + +m[3] * 60) : 0;
}

export const formatOffset = (sec: number) => {
  const sign = sec < 0 ? '-' : '+';
  const a = Math.abs(sec);
  return `UTC${sign}${Math.floor(a / 3600)}${a % 3600 ? ':' + String((a % 3600) / 60).padStart(2, '0') : ''}`;
};

/** Tên IANA của trình duyệt, null nếu không có Intl (bản gốc cũng bọc try/catch). */
export function browserTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

/**
 * Offset thật của người dùng (phút, dương = phía đông UTC) khi đồng hồ máy có thể bị chỉnh tay.
 * Máy để múi UTC nhưng chỉnh kim cho khớp giờ Hà Nội thì đồng hồ "nhanh" 7 giờ so với server:
 * lấy độ lệch đó, làm tròn 15 phút, cộng vào offset trình duyệt báo.
 */
export function effectiveOffsetMinutes(serverMs: number, clientMs: number, browserOffsetMin: number): number {
  const skew = Math.round((clientMs - serverMs) / 60_000 / 15) * 15;
  let off = (browserOffsetMin + skew) % (24 * 60);
  // hợp lệ từ UTC-12 tới UTC+14 (Kiribati), ngoài khoảng đó thì quay vòng 24 giờ
  if (off < -12 * 60) off += 24 * 60;
  else if (off > 14 * 60) off -= 24 * 60;
  return off;
}

// ---------------- dò và đoán múi giờ từ môi trường ----------------

export type OffsetProbe = (ms: number) => number;

/**
 * Dò các lần đổi giờ chỉ bằng một hàm "offset tại thời điểm t" (Date.getTimezoneOffset hay Intl):
 * bước nhảy thô `step`, thấy offset khác thì tìm nhị phân tới đúng mili giây (như extractTimezoneTransitions).
 */
export function extractTransitions(probe: OffsetProbe, startMs: number, endMs: number, step = 7 * 86_400_000) {
  const out: { at: number; offset: number }[] = [];
  let prev = probe(startMs);
  for (let t = startMs; t < endMs; t += step) {
    const next = probe(t + step);
    if (next === prev) continue;
    let lo = t; // probe(lo) === prev
    let hi = t + step; // probe(hi) === next
    while (hi - lo > 1) {
      const mid = Math.floor((lo + hi) / 2);
      if (probe(mid) === prev) lo = mid;
      else hi = mid;
    }
    if (hi < endMs) out.push({ at: hi, offset: next });
    prev = next;
  }
  return out;
}

/** Cây quyết định: hỏi offset tại `at`, rẽ nhánh theo kết quả; lá là nhóm múi giờ không phân biệt được. */
export type TzTree = { at: number; branches: Record<string, TzTree> } | { zones: string[] };

export function buildTzTree(zones: string[], probes: number[], offset: (zone: string, ms: number) => number): TzTree {
  const table = new Map(zones.map((z) => [z, probes.map((t) => offset(z, t))]));
  const grow = (ids: string[]): TzTree => {
    let best = -1;
    let bestWorst = ids.length;
    probes.forEach((_, i) => {
      const sizes = new Map<number, number>();
      for (const z of ids) sizes.set(table.get(z)![i], (sizes.get(table.get(z)![i]) ?? 0) + 1);
      const worst = Math.max(...sizes.values()); // nhóm lớn nhất sau khi hỏi câu này
      if (worst < bestWorst) [best, bestWorst] = [i, worst];
    });
    if (best < 0) return { zones: ids }; // không câu hỏi nào tách được nữa
    const groups: Record<string, string[]> = {};
    for (const z of ids) (groups[table.get(z)![best]] ??= []).push(z);
    const branches: Record<string, TzTree> = {};
    for (const [k, g] of Object.entries(groups)) branches[k] = grow(g);
    return { at: probes[best], branches };
  };
  return grow(zones);
}

export function guessZone(tree: TzTree, probe: OffsetProbe): { zones: string[]; questions: number } {
  let questions = 0;
  while ('at' in tree) {
    const next = tree.branches[String(probe(tree.at))];
    questions++;
    if (!next) return { zones: [], questions };
    tree = next;
  }
  return { zones: tree.zones, questions };
}
