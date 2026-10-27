/**
 * Lọc danh sách lớn theo nhiều điều kiện, tái dùng kết quả lần lọc trước.
 *
 * Ý tưởng từ trình tạo segment của Similarweb (segmentsWizardService.worker.ts): các điều kiện được nối
 * bằng VÀ, nên thêm điều kiện chỉ làm tập kết quả nhỏ đi. Nếu bộ điều kiện mới chứa đủ bộ cũ thì
 * chỉ cần lọc tiếp KẾT QUẢ CŨ bằng phần điều kiện mới thêm, khỏi quét lại từ đầu.
 */

export interface Rule {
  /** include: trang phải chứa ít nhất một từ; exclude: không được chứa từ nào */
  mode: 'include' | 'exclude';
  words: string[];
}

export interface Page {
  url: string;
  share: number;
  /** các từ trong URL, tách sẵn một lần lúc nạp dữ liệu */
  tokens: Set<string>;
}

/** Tách URL thành từ: mọi ký tự không phải chữ hay số (kể cả chữ có dấu) đều là dấu ngăn. */
export function tokenize(url: string): Set<string> {
  const path = url.replace(/^https?:\/\/[^/]+/, '');
  return new Set(
    path
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter(Boolean),
  );
}

const normalizeWords = (words: string[]) =>
  [...new Set(words.map((w) => w.trim().toLowerCase()).filter(Boolean))].sort();

/** Khoá so sánh hai điều kiện: cùng mode và cùng tập từ (không tính thứ tự, hoa thường). */
export const ruleKey = (rule: Rule) => `${rule.mode}:${normalizeWords(rule.words).join('|')}`;

/**
 * "Biên dịch" điều kiện MỘT lần thành hàm kiểm tra. Similarweb tạo `new RegExp(...)` bên trong
 * vòng lọc, tức là một regex mới cho mỗi URL × mỗi điều kiện.
 */
export function compilePageRule(rule: Rule): (page: Page) => boolean {
  const words = normalizeWords(rule.words);
  const include = rule.mode === 'include';
  return (page) => words.some((w) => page.tokens.has(w)) === include;
}

/**
 * Bản đối chứng mô phỏng cách Similarweb kiểm tra "cụm từ chính xác": tạo `new RegExp(…, 'gi')`
 * cho MỖI URL × mỗi từ. Chỉ để đo trong demo, đừng dùng.
 */
export function compileRegexRuleSlow(rule: Rule): (page: Page) => boolean {
  const include = rule.mode === 'include';
  const escape = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return (page) => rule.words.some((w) => new RegExp(escape(w.trim()), 'gi').test(page.url)) === include;
}

export interface FilterRun<T> {
  result: T[];
  /** số phần tử đã phải kiểm tra trong lần này */
  scanned: number;
  /** true nếu lọc tiếp trên kết quả lần trước */
  reused: boolean;
}

export function createIncrementalFilter<T>(items: readonly T[], compile: (rule: Rule) => (item: T) => boolean) {
  let last: { keys: string[]; result: T[] } | null = null;

  function run(rules: Rule[], { incremental = true } = {}): FilterRun<T> {
    const keys = rules.map(ruleKey);

    // Đếm số lần xuất hiện của từng khoá để so như "túi" (multiset): [a, a] không chứa trong [a]
    let base: readonly T[] = items;
    let extra = rules;
    if (incremental && last && last.keys.length > 0) {
      const remaining = new Map<string, number>();
      keys.forEach((k) => remaining.set(k, (remaining.get(k) ?? 0) + 1));
      const containsOld = last.keys.every((k) => {
        const n = remaining.get(k) ?? 0;
        remaining.set(k, n - 1);
        return n > 0;
      });
      if (containsOld) {
        base = last.result;
        extra = rules.filter((r) => {
          const k = ruleKey(r);
          const n = remaining.get(k) ?? 0;
          if (n <= 0) return false;
          remaining.set(k, n - 1);
          return true;
        });
      }
    }

    // Lỗi ở đây cứ để ném ra: Similarweb nuốt lỗi rồi trả kết quả CŨ của bộ điều kiện khác
    const checks = extra.map(compile);
    const result = checks.length === 0 ? [...base] : base.filter((item) => checks.every((check) => check(item)));
    last = { keys, result };
    return { result, scanned: checks.length === 0 ? 0 : base.length, reused: base !== items };
  }

  return {
    run,
    reset() {
      last = null;
    },
  };
}

// ---- dữ liệu giả cho demo: URL "trang phổ biến" của một website ----

const SECTIONS = ['blog', 'docs', 'shop', 'help', 'news', 'careers', 'vi', 'en'];
const WORDS = [
  'react', 'hooks', 'pricing', 'guide', 'api', 'mobile', 'login', 'cart', 'sale', 'giày',
  'sách', 'laptop', 'review', 'tutorial', 'release', 'security', 'performance', 'cache',
  'worker', 'design', 'team', 'remote', 'tuyển', 'dụng', 'faq', 'refund', 'shipping', 'account',
];

/** Sinh `count` URL giả, có seed để trang chính và worker sinh ra cùng một dữ liệu. */
export function generatePages(count: number, seed = 1): Page[] {
  let s = seed;
  const rand = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const pick = <V>(list: V[]) => list[Math.floor(rand() * list.length)];
  const pages: Page[] = [];
  for (let i = 0; i < count; i++) {
    const url = `https://example.vn/${pick(SECTIONS)}/${pick(WORDS)}-${pick(WORDS)}-${i}`;
    pages.push({ url, share: rand() / count, tokens: tokenize(url) });
  }
  return pages;
}
