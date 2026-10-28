/**
 * Kiểm tra "version có nằm trong range không", cú pháp giống npm (ý tưởng từ VersionRange của Facebook).
 *
 * Hỗ trợ: `||`, khoảng gạch nối `1.2 - 2.3`, nhiều điều kiện cách nhau bởi dấu cách (AND),
 * `^`, `~` (và `~>`), wildcard `x`/`*`/thiếu số, so sánh prerelease theo semver 2.0.
 *
 * Khác bản gốc: bản gốc không có `^` (luôn trả false, không báo lỗi), không có AND bằng dấu cách
 * (`">=1.2 <2"` thành `">=1.2"`), so prerelease bằng so chuỗi nên `1.0.0-rc.1` lớn hơn `1.0.0`,
 * và `~1.2` hiểu theo kiểu Ruby (`< 2`) thay vì npm (`< 1.3`).
 */

export interface Version {
  major: number;
  minor: number;
  patch: number;
  pre: (string | number)[];
}

const VERSION = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z.-]+)?$/;

export function parseVersion(text: string): Version {
  const m = VERSION.exec(text.trim());
  if (!m) throw new SyntaxError(`Version không hợp lệ: "${text}"`);
  const pre = m[4] ? m[4].split('.').map((id) => (/^\d+$/.test(id) ? Number(id) : id)) : [];
  return { major: +m[1], minor: +m[2], patch: +m[3], pre };
}

/**
 * Version "lỏng" kiểu trình duyệt/hệ điều hành: "15.4", "120.0.6099.109", "NT 10.0".
 * Đúng chuẩn semver thì giữ nguyên (kể cả prerelease), còn lại lấy tối đa ba số đầu, thiếu thì lấp 0.
 */
export function coerceVersion(text: string): Version {
  if (VERSION.test(text.trim())) return parseVersion(text);
  const m = /(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(text);
  if (!m) throw new SyntaxError(`Không tìm thấy số version trong "${text}"`);
  return ver(+m[1], +(m[2] ?? 0), +(m[3] ?? 0));
}

function comparePre(a: Version['pre'], b: Version['pre']): number {
  if (!a.length || !b.length) return b.length - a.length; // không có prerelease thì lớn hơn
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i];
    const y = b[i];
    if (x === undefined) return -1; // 1.0.0-alpha < 1.0.0-alpha.1
    if (y === undefined) return 1;
    if (x === y) continue;
    if (typeof x === 'number' && typeof y === 'number') return x < y ? -1 : 1;
    if (typeof x === 'number') return -1; // số luôn nhỏ hơn chữ
    if (typeof y === 'number') return 1;
    return x < y ? -1 : 1; // so ASCII
  }
  return 0;
}

export function compareVersions(a: Version, b: Version): number {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch || comparePre(a.pre, b.pre);
}

type Op = '<' | '<=' | '>' | '>=' | '=';
interface Comparator {
  op: Op;
  v: Version;
}

/** "1.2" → [1, 2, null]; x, X, * và phần thiếu đều là null */
function partial(text: string): { nums: (number | null)[]; pre: Version['pre'] } {
  const m = /^v?(\d+|[xX*])?(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(text);
  if (!m) throw new SyntaxError(`Range không hợp lệ: "${text}"`);
  const nums = [m[1], m[2], m[3]].map((p) => (p === undefined || /^[xX*]$/.test(p) ? null : Number(p)));
  // sau một chỗ wildcard thì mọi phần sau cũng là wildcard: 1.x.3 = 1.x
  const firstWild = nums.indexOf(null);
  if (firstWild >= 0) nums.fill(null, firstWild);
  const pre = m[4] ? m[4].split('.').map((id) => (/^\d+$/.test(id) ? Number(id) : id)) : [];
  return { nums, pre };
}

const ver = (major: number, minor = 0, patch = 0, pre: Version['pre'] = []): Version => ({ major, minor, patch, pre });
/** "-0" là prerelease nhỏ nhất: <2.0.0-0 loại cả 2.0.0-alpha */
const floor = (major: number, minor = 0, patch = 0) => ver(major, minor, patch, [0]);

function desugar(token: string, incPre: boolean): Comparator[] {
  const m = /^(\^|~>?|<=|>=|<|>|=)?(.*)$/.exec(token)!;
  const op = m[1] ?? '';
  const { nums, pre } = partial(m[2]);
  const [M, m2, p] = nums;
  if (M === null) return op === '<' || op === '>' ? [{ op: '<', v: floor(0) }] : []; // "*" khớp tất cả, "<*" không gì
  const exact = p !== null;
  // includePrerelease: cận dưới của range thiếu số hạ xuống "-0" để ">=1.2" nhận cả 1.2.0-alpha
  const low = (major: number, minor = 0) => (incPre ? floor(major, minor) : ver(major, minor));
  const lower = exact ? ver(M, m2!, p, pre) : low(M, m2 ?? 0);
  // phần trên của một x-range: 1.2 → <1.3.0-0, 1 → <2.0.0-0
  const next = () => (m2 === null ? floor(M + 1) : floor(M, m2 + 1));

  if (op === '^') {
    const upper = M > 0 || m2 === null ? floor(M + 1) : m2 > 0 || p === null ? floor(0, m2 + 1) : floor(0, 0, p! + 1);
    return [
      { op: '>=', v: lower },
      { op: '<', v: upper },
    ];
  }
  if (op.startsWith('~')) {
    return [
      { op: '>=', v: exact ? lower : ver(M, m2 ?? 0) }, // npm không hạ "-0" cho ~
      { op: '<', v: next() },
    ];
  }
  switch (op) {
    case '':
    case '=':
      return exact
        ? [{ op: '=', v: lower }]
        : [
            { op: '>=', v: lower },
            { op: '<', v: next() },
          ];
    case '>': {
      if (exact) return [{ op: '>', v: lower }];
      const n = next();
      return [{ op: '>=', v: incPre ? n : ver(n.major, n.minor) }];
    }
    case '>=':
      return [{ op: '>=', v: lower }];
    case '<':
      return [{ op: '<', v: exact ? lower : floor(M, m2 ?? 0) }];
    case '<=':
      return [exact ? { op: '<=', v: lower } : { op: '<', v: next() }];
  }
  throw new SyntaxError(`Toán tử lạ: ${op}`);
}

/** "1.2 - 2.3": đầu thiếu số thì lấp 0, cuối thiếu số thì lấy "< phiên bản kế tiếp" */
function hyphen(from: string, to: string, incPre: boolean): Comparator[] {
  const out: Comparator[] = [];
  const a = partial(from);
  if (a.nums[0] !== null) {
    const [M, m, p] = a.nums as number[];
    if (p === null || a.pre.length) out.push(...desugar('>=' + from, incPre));
    else out.push({ op: '>=', v: incPre ? floor(M, m, p) : ver(M, m, p) });
  }
  const b = partial(to);
  if (b.nums[0] !== null) {
    const [M, m, p] = b.nums as number[];
    if (p === null || b.pre.length || !incPre) out.push(...desugar('<=' + to, incPre));
    else out.push({ op: '<', v: floor(M, m, p + 1) });
  }
  return out;
}

function parseSet(set: string, incPre: boolean): Comparator[] {
  const h = /^(\S+)\s+-\s+(\S+)$/.exec(set);
  if (h) return hyphen(h[1], h[2], incPre);
  // ">= 1.2" → ">=1.2" rồi tách theo khoảng trắng: mọi điều kiện phải cùng đúng
  const tokens = set.replace(/(\^|~>?|<=|>=|<|>|=)\s+/g, '$1').split(/\s+/).filter(Boolean);
  return tokens.flatMap((t) => desugar(t, incPre));
}

export function parseRange(range: string, includePrerelease = false): Comparator[][] {
  return range.split('||').map((s) => parseSet(s.trim(), includePrerelease));
}

const test = (v: Version, c: Comparator) => {
  const r = compareVersions(v, c.v);
  return c.op === '<' ? r < 0 : c.op === '<=' ? r <= 0 : c.op === '>' ? r > 0 : c.op === '>=' ? r >= 0 : r === 0;
};

export interface SatisfiesOptions {
  /** mặc định false như npm: 2.0.0-beta chỉ khớp range có nhắc prerelease của chính 2.0.0 */
  includePrerelease?: boolean;
  /** nhận version thiếu số hoặc dư số ("15.4", "120.0.6099.109") bằng coerceVersion */
  loose?: boolean;
}

export function satisfies(
  version: string,
  range: string,
  { includePrerelease = false, loose = false }: SatisfiesOptions = {},
) {
  const v = loose ? coerceVersion(version) : parseVersion(version);
  return parseRange(range, includePrerelease).some((set) => {
    if (!set.every((c) => test(v, c))) return false;
    if (!v.pre.length || includePrerelease) return true;
    // prerelease chỉ lọt qua khi chính range nhắc tới prerelease của cùng major.minor.patch
    return set.some(
      (c) => c.v.pre.length > 0 && c.v.major === v.major && c.v.minor === v.minor && c.v.patch === v.patch,
    );
  });
}
