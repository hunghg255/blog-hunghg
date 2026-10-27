/**
 * Intl thực chiến: bốn việc nhỏ mà app đa ngôn ngữ nào cũng gặp.
 *
 * - truncateAtSentence: cắt mô tả gần giới hạn ký tự, ưu tiên hết câu (ý tưởng từ
 *   truncateAroundLimit của apps.apple.com).
 * - compactNumber: "12K" theo locale, có thể ép chữ số Latin (-u-nu-latn) như App Store.
 * - pluralForm: chọn dạng số nhiều bằng Intl.PluralRules thay cho regex tự viết
 *   (Outlook: owa-measurementunit-formatter).
 * - resolveLocale: tìm locale được hỗ trợ gần nhất theo BCP 47 (Outlook:
 *   getSupportedFallbackForLocale), dùng Intl.Locale.maximize() thay cho bảng tra tay.
 */

// ---------- 1. Cắt theo câu ----------

export type TruncateLevel = 'none' | 'sentence' | 'word' | 'grapheme';

export interface TruncateResult {
  text: string;
  level: TruncateLevel;
}

export interface TruncateOptions {
  locale?: string;
  /** kết quả cắt theo câu phải dài ít nhất bằng tỉ lệ này của limit, mặc định 0.75 như Apple */
  minRatio?: number;
  ellipsis?: string;
}

const hasSegmenter = typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function';

// dấu câu treo ở cuối trước khi thêm "…": "xin chào, …" trông như lỗi
const TRAILING_PUNCT = /[\s,;:–—-]+$/u;

export function truncateAtSentence(
  text: string,
  limit: number,
  { locale = 'vi', minRatio = 0.75, ellipsis = '…' }: TruncateOptions = {},
): TruncateResult {
  if (text.length <= limit) return { text, level: 'none' };

  if (!hasSegmenter) {
    // fallback: cắt ở khoảng trắng cuối cùng trước limit
    const head = text.slice(0, limit);
    const space = head.lastIndexOf(' ');
    // lastIndexOf trả -1 khi không có khoảng trắng: phải so > 0, đừng dùng `if (space)`
    const cut = space > 0 ? head.slice(0, space) : head;
    return { text: cut.replace(TRAILING_PUNCT, '') + ellipsis, level: space > 0 ? 'word' : 'grapheme' };
  }

  // 1) gom từng câu nguyên vẹn
  let result = '';
  for (const { segment } of new Intl.Segmenter(locale, { granularity: 'sentence' }).segment(text)) {
    if (result.length + segment.length > limit) break;
    result += segment;
  }
  result = result.trim();
  if (result.length >= limit * minRatio) return { text: result, level: 'sentence' };

  // 2) không đủ dài: gom từng từ (chừa chỗ cho dấu …)
  const budget = limit - ellipsis.length;
  result = '';
  for (const { segment } of new Intl.Segmenter(locale, { granularity: 'word' }).segment(text)) {
    if (result.length + segment.length > budget) break;
    result += segment;
  }
  result = result.replace(TRAILING_PUNCT, '');
  if (result.length > 0) return { text: result + ellipsis, level: 'word' };

  // 3) một "từ" dài hơn cả limit (URL, chuỗi không dấu cách): cắt theo grapheme,
  // không cắt đôi emoji hay chữ có dấu tổ hợp
  result = '';
  for (const { segment } of new Intl.Segmenter(locale, { granularity: 'grapheme' }).segment(text)) {
    if (result.length + segment.length > budget) break;
    result += segment;
  }
  return { text: result + ellipsis, level: 'grapheme' };
}

// ---------- 2. Số rút gọn ----------

/** Locale mà sản phẩm muốn hiện chữ số Latin thay vì chữ số bản địa (App Store ép hi-IN, my). */
export const LATIN_DIGITS_LOCALES = new Set(['hi-in', 'my']);

/** Thêm Unicode extension -u-nu-latn: "nu" = numbering system, "latn" = 0-9. */
export function withLatinDigits(locale: string): string {
  try {
    return new Intl.Locale(locale, { numberingSystem: 'latn' }).toString();
  } catch {
    return locale;
  }
}

export function compactNumber(value: number, locale: string, forceLatin = LATIN_DIGITS_LOCALES.has(locale.toLowerCase())) {
  const tag = forceLatin ? withLatinDigits(locale) : locale;
  const formatter = new Intl.NumberFormat(tag, { notation: 'compact' });
  return { text: formatter.format(value), numberingSystem: formatter.resolvedOptions().numberingSystem, tag };
}

// ---------- 3. Số nhiều ----------

/** Mỗi ngôn ngữ chỉ cần khai báo các dạng nó có; thiếu dạng nào thì rơi về `other`. */
export type PluralForms = Partial<Record<Intl.LDMLPluralRule, string>> & { other: string };

export function pluralForm(count: number, forms: PluralForms, locale: string): string {
  const category = new Intl.PluralRules(locale).select(count);
  return (forms[category] ?? forms.other).replace('#', new Intl.NumberFormat(locale).format(count));
}

/**
 * Bản sao logic regex của Outlook để so sánh trong demo: trả về 0 (singular),
 * 1 (firstPlural) hoặc 2 (secondPlural). Chỉ đúng cho số nguyên và tối đa 3 dạng.
 */
const OUTLOOK_RULES: Record<string, [RegExp, RegExp]> = {
  cs: [/^1$/, /^[234]$/],
  sk: [/^1$/, /^[234]$/],
  sl: [/^1$/, /^[234]$/],
  uk: [/^1$/, /^[234]$/],
  pl: [/^1$/, /^[234]$|[^1][234]$/],
  ru: [/^1$|[^1]1$/, /^[234]$|[^1][234]$/],
  lt: [/^1$|[^1]1$/, /^[234]$|[^1][234]$/],
  lv: [/^1$|[^1]1$/, /^[234]$|[^1][234]$/],
};

export function outlookPluralIndex(count: number, lang: string): 0 | 1 | 2 {
  const [singular, plural] = OUTLOOK_RULES[lang] ?? [/^1$/, /./];
  const s = count.toString(10);
  if (singular.test(s)) return 0;
  if (plural.test(s)) return 1;
  return 2;
}

// ---------- 4. Chọn locale được hỗ trợ ----------

export interface ResolvedLocale {
  locale: string;
  dir: 'ltr' | 'rtl';
  /** các ứng viên đã thử theo thứ tự */
  tried: string[];
  notFound?: boolean;
}

const RTL_SCRIPTS = new Set(['Arab', 'Hebr', 'Thaa', 'Syrc', 'Nkoo', 'Adlm', 'Rohg', 'Mand', 'Samr']);

/** Hướng chữ: dùng getTextInfo() nếu trình duyệt có, nếu không thì suy ra từ script. */
export function textDirection(locale: string): 'ltr' | 'rtl' {
  try {
    const loc = new Intl.Locale(locale) as Intl.Locale & {
      getTextInfo?: () => { direction: 'ltr' | 'rtl' };
      textInfo?: { direction: 'ltr' | 'rtl' };
    };
    const info = loc.getTextInfo?.() ?? loc.textInfo;
    if (info) return info.direction;
    return RTL_SCRIPTS.has(loc.maximize().script ?? '') ? 'rtl' : 'ltr';
  } catch {
    return 'ltr';
  }
}

/**
 * Ứng viên theo thứ tự ưu tiên: nguyên tag, rồi bản có script (zh-TW -> zh-Hant), rồi tỉa dần
 * subtag từ phải sang (Outlook: localeParts.pop()).
 */
export function fallbackChain(requested: string): string[] {
  const chain: string[] = [];
  const push = (tag: string) => {
    if (tag && !chain.some((c) => c.toLowerCase() === tag.toLowerCase())) chain.push(tag);
  };
  let canonical = requested;
  try {
    canonical = Intl.getCanonicalLocales(requested.replace(/_/g, '-'))[0];
  } catch {
    // tag không hợp lệ: vẫn thử tỉa thủ công
  }
  const parts = canonical.split('-');
  push(canonical);
  try {
    const max = new Intl.Locale(canonical).maximize();
    if (max.script) {
      push(max.region ? `${max.language}-${max.script}-${max.region}` : '');
      push(`${max.language}-${max.script}`);
    }
  } catch {
    // bỏ qua
  }
  while (parts.length > 1) {
    parts.pop();
    push(parts.join('-'));
  }
  return chain;
}

export interface ResolveOptions {
  defaultLocale?: string;
  /** ngoại lệ không suy ra được bằng quy tắc, vd { nb: 'no' } (Bokmål dùng bản dịch tiếng Na Uy chung) */
  aliases?: Record<string, string>;
}

export function resolveLocale(
  requested: string,
  supported: readonly string[],
  { defaultLocale = 'en', aliases = {} }: ResolveOptions = {},
): ResolvedLocale {
  const byLower = new Map(supported.map((s) => [s.toLowerCase(), s]));
  const aliasByLower = new Map(Object.entries(aliases).map(([k, v]) => [k.toLowerCase(), v]));
  const tried = fallbackChain(requested);
  for (const candidate of tried) {
    const key = candidate.toLowerCase();
    const hit = byLower.get(key) ?? byLower.get(aliasByLower.get(key)?.toLowerCase() ?? '');
    if (hit) return { locale: hit, dir: textDirection(hit), tried };
  }
  return { locale: defaultLocale, dir: textDirection(defaultLocale), tried, notFound: true };
}
