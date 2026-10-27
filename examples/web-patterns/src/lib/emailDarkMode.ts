/**
 * Dark mode cho HTML không do mình viết (email, nội dung CMS, bài dán từ Word…).
 * Ý tưởng từ owa-dark-mode-utilities của Outlook Web: chỉ sửa phần tử nào thiếu tương phản,
 * đổi màu trong không gian CIELAB, GIỮ NGUYÊN sắc độ (a*, b*) và chỉ đổi độ sáng L*.
 */

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

// ---- Đọc màu ----

/**
 * Parse màu từ getComputedStyle (luôn ra "rgb(…)" / "rgba(…)") hoặc dạng hex "#rgb", "#rrggbb".
 * Trả về null với giá trị lạ, thay vì ném lỗi như thư viện `color` mà Outlook phải bọc try/catch.
 */
export function parseColor(input: string): Rgba | null {
  const s = input.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(s);
  if (hex) {
    const h = hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join('') : hex[1];
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: 1 };
  }
  const fn = /^rgba?\(([^)]+)\)$/.exec(s);
  if (!fn) return null;
  const parts = fn[1].split(/[\s,/]+/).filter(Boolean).map(Number);
  if (parts.length < 3 || parts.some(Number.isNaN)) return null;
  return { r: parts[0], g: parts[1], b: parts[2], a: parts[3] ?? 1 };
}

export const toCss = ({ r, g, b, a }: Rgba) =>
  a >= 1 ? `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})` : `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${a})`;

// ---- sRGB ⇄ CIELAB (D65) ----

const toLinear = (c: number) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const fromLinear = (v: number) => {
  const c = v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
  return Math.min(255, Math.max(0, c * 255));
};

// điểm trắng D65
const XN = 0.95047;
const YN = 1;
const ZN = 1.08883;
const EPS = 216 / 24389;
const KAPPA = 24389 / 27;

export function rgbToLab({ r, g, b }: Rgba): [number, number, number] {
  const R = toLinear(r);
  const G = toLinear(g);
  const B = toLinear(b);
  const x = (R * 0.4124564 + G * 0.3575761 + B * 0.1804375) / XN;
  const y = (R * 0.2126729 + G * 0.7151522 + B * 0.072175) / YN;
  const z = (R * 0.0193339 + G * 0.119192 + B * 0.9503041) / ZN;
  const f = (t: number) => (t > EPS ? Math.cbrt(t) : (KAPPA * t + 16) / 116);
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

export function labToRgb([L, A, Bv]: [number, number, number], alpha = 1): Rgba {
  const fy = (L + 16) / 116;
  const fx = fy + A / 500;
  const fz = fy - Bv / 200;
  const inv = (t: number) => (t ** 3 > EPS ? t ** 3 : (116 * t - 16) / KAPPA);
  const x = inv(fx) * XN;
  const y = (L > KAPPA * EPS ? fy ** 3 : L / KAPPA) * YN;
  const z = inv(fz) * ZN;
  const R = x * 3.2404542 - y * 1.5371385 - z * 0.4985314;
  const G = -x * 0.969266 + y * 1.8760108 + z * 0.041556;
  const B = x * 0.0556434 - y * 0.2040259 + z * 1.0572252;
  return { r: fromLinear(R), g: fromLinear(G), b: fromLinear(B), a: alpha };
}

// ---- Tương phản WCAG 2 ----

export function luminance({ r, g, b }: Rgba): number {
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

export function contrast(c1: Rgba, c2: Rgba): number {
  const l1 = luminance(c1);
  const l2 = luminance(c2);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

/** Ngưỡng AA cho chữ thường. Outlook dùng đúng con số này (VALID_CONTRAST_VALUE = 4.5). */
export const MIN_CONTRAST = 4.5;

/**
 * Tính lại độ sáng L* cho `color` để tương phản được với `against`, trên nền tối có độ sáng `baseL`.
 * Công thức theo fixContrast() của Outlook:
 * 1. Nén L* từ [0, 100] vào [baseL, 100]: không màu nào tối hơn chính nền dark mode.
 * 2. Màu cần so sánh mà sáng thì lật màu này về phía tối, ngược lại lật về phía sáng,
 *    rồi kéo giãn để tránh "vùng chết" quanh giữa (do baseL không bằng 0).
 */
export function fixLightness(L: number, againstL: number, baseL: number): number {
  const ceilingDark = 50; // tối hơn mức này mới tương phản nổi với trắng (L = 100)
  const floorLight = 50 + baseL; // sáng hơn mức này mới tương phản nổi với nền (L = baseL)
  const mid = (floorLight + ceilingDark) / 2;

  let next = L * ((100 - baseL) / 100) + baseL;
  if (againstL > mid) {
    next = Math.min(next, 2 * mid - next);
    next = ((next - baseL) * (ceilingDark - baseL)) / (mid - baseL) + baseL;
  } else {
    next = Math.max(next, 2 * mid - next);
    next = 100 - ((100 - next) * (100 - floorLight)) / (100 - mid);
  }
  return Math.min(100, Math.max(0, next));
}

/** Giữ a*, b* (sắc độ), chỉ thay L*. Đây là lý do màu thương hiệu vẫn "ra màu thương hiệu". */
export function fixContrast(color: Rgba, against: Rgba, base: Rgba): Rgba {
  const [L, A, B] = rgbToLab(color);
  const baseL = rgbToLab(base)[0];
  const againstL = rgbToLab(against)[0];
  return labToRgb([fixLightness(L, againstL, baseL), A, B], color.a);
}

// ---- Áp lên DOM, nhớ màu gốc để hoàn tác và để copy ----

// Cùng tên thuộc tính với Outlook (owa-content-colors-constants)
const OG_STYLE_COLOR = 'data-ogsc';
const OG_ATTR_COLOR = 'data-ogac';
const OG_STYLE_BG = 'data-ogsb';
const OG_ATTR_BG = 'data-ogab';

export interface ChangedElement {
  element: HTMLElement;
  property: 'color' | 'background-color';
  before: string;
  after: string;
  contrastBefore: number;
  contrastAfter: number;
}

/**
 * Sửa một phần tử. Phải gọi theo thứ tự cha trước con (thứ tự của querySelectorAll):
 * con không tự đặt màu sẽ thừa hưởng màu đã sửa của cha, nên không cần sửa lại.
 */
export function transformElement(element: HTMLElement, base: Rgba): ChangedElement[] {
  const changes: ChangedElement[] = [];
  const cs = getComputedStyle(element);
  let text = parseColor(cs.color);
  if (!text) return changes;

  // 1. Màu chữ so với nền dark mode
  const contrastText = contrast(text, base);
  if (contrastText < MIN_CONTRAST) {
    const fixed = fixContrast(text, base, base);
    if (!element.hasAttribute(OG_STYLE_COLOR)) element.setAttribute(OG_STYLE_COLOR, element.style.color);
    element.style.setProperty('color', toCss(fixed), 'important');
    const attr = element.getAttribute('color'); // <font color="…"> kiểu cũ
    if (attr !== null) {
      if (!element.hasAttribute(OG_ATTR_COLOR)) element.setAttribute(OG_ATTR_COLOR, attr);
      // Word khi dán ưu tiên thuộc tính color hơn CSS, nên sửa cả thuộc tính
      element.setAttribute('color', toCss(fixed));
    }
    changes.push({ element, property: 'color', before: toCss(text), after: toCss(fixed), contrastBefore: contrastText, contrastAfter: contrast(fixed, base) });
    text = fixed;
  }

  // 2. Màu nền so với màu chữ (đã sửa). Nền trong suốt thì bỏ qua: nó để lộ nền dark mode.
  //    (Bản gốc không bỏ qua mà để thư viện `color` coi rgba(0,0,0,0) là đen, kết quả tình cờ đúng.)
  const bg = parseColor(cs.backgroundColor);
  if (bg && bg.a > 0) {
    const contrastBg = contrast(bg, text);
    if (contrastBg < MIN_CONTRAST) {
      const fixed = fixContrast(bg, text, base);
      if (!element.hasAttribute(OG_STYLE_BG)) element.setAttribute(OG_STYLE_BG, element.style.backgroundColor);
      element.style.setProperty('background-color', toCss(fixed), 'important');
      const attr = element.getAttribute('bgcolor'); // <td bgcolor="…">
      if (attr !== null) {
        if (!element.hasAttribute(OG_ATTR_BG)) element.setAttribute(OG_ATTR_BG, attr);
        element.setAttribute('bgcolor', toCss(fixed));
      }
      changes.push({ element, property: 'background-color', before: toCss(bg), after: toCss(fixed), contrastBefore: contrastBg, contrastAfter: contrast(fixed, text) });
    }
  }
  return changes;
}

/** Áp dark mode cho cả cây. `root` phải đang hiển thị trên nền `baseColor` (màu nền dark mode). */
export function applyDarkMode(root: HTMLElement, baseColor: string): ChangedElement[] {
  const base = parseColor(baseColor);
  if (!base) throw new Error(`Màu nền không hợp lệ: ${baseColor}`);
  const all = [root, ...root.querySelectorAll<HTMLElement>('*')];
  return all.flatMap((el) => transformElement(el, base));
}

interface SavedColors {
  styleColor: string;
  styleBg: string;
  attrColor: string | null;
  attrBg: string | null;
}

const readColors = (el: HTMLElement): SavedColors => ({
  styleColor: el.style.getPropertyValue('color'),
  styleBg: el.style.getPropertyValue('background-color'),
  attrColor: el.getAttribute('color'),
  attrBg: el.getAttribute('bgcolor'),
});

function writeColors(el: HTMLElement, c: Partial<SavedColors>, important = false) {
  const prio = important ? 'important' : '';
  if (c.styleColor !== undefined) el.style.setProperty('color', c.styleColor, prio);
  if (c.styleBg !== undefined) el.style.setProperty('background-color', c.styleBg, prio);
  if (c.attrColor !== undefined) c.attrColor === null ? el.removeAttribute('color') : el.setAttribute('color', c.attrColor);
  if (c.attrBg !== undefined) c.attrBg === null ? el.removeAttribute('bgcolor') : el.setAttribute('bgcolor', c.attrBg);
}

/** Màu gốc đã cất trong data-og-*, chỉ những gì đã bị sửa. */
function originalColors(el: HTMLElement): Partial<SavedColors> {
  const out: Partial<SavedColors> = {};
  if (el.hasAttribute(OG_STYLE_COLOR)) out.styleColor = el.getAttribute(OG_STYLE_COLOR)!;
  if (el.hasAttribute(OG_STYLE_BG)) out.styleBg = el.getAttribute(OG_STYLE_BG)!;
  if (el.hasAttribute(OG_ATTR_COLOR)) out.attrColor = el.getAttribute(OG_ATTR_COLOR);
  if (el.hasAttribute(OG_ATTR_BG)) out.attrBg = el.getAttribute(OG_ATTR_BG);
  return out;
}

/** Hoàn tác toàn bộ: trả màu gốc và dọn các thuộc tính data-og-*. */
export function undoDarkMode(root: HTMLElement) {
  for (const el of [root, ...root.querySelectorAll<HTMLElement>('*')]) {
    const og = originalColors(el);
    if (Object.keys(og).length === 0) continue;
    writeColors(el, og);
    [OG_STYLE_COLOR, OG_STYLE_BG, OG_ATTR_COLOR, OG_ATTR_BG].forEach((a) => el.removeAttribute(a));
  }
}

/**
 * Gắn vào sự kiện `copy` của khung email. Clipboard được chụp ĐỒNG BỘ ngay sau handler, nên:
 * trả màu gốc ngay trong handler → trình duyệt chép màu gốc → frame sau đặt lại màu dark mode.
 * Người dùng dán sang Word/Gmail sẽ không bị "chữ trắng trên nền trắng".
 */
export function copyWithOriginalColors(root: HTMLElement, lightBackground = 'white', lightText = 'black') {
  // chỉ đụng vào phần tử đã bị dark mode sửa (có data-og-*)
  const elements = [...root.querySelectorAll<HTMLElement>('*')].filter(
    (el) => Object.keys(originalColors(el)).length > 0,
  );
  const saved = elements.map(readColors);
  const rootStyle = { bg: root.style.backgroundColor, color: root.style.color };
  // khung ngoài đang tô nền tối/chữ sáng bằng CSS của app: tạm đổi về nền sáng
  root.style.backgroundColor = lightBackground;
  root.style.color = lightText;
  elements.forEach((el) => writeColors(el, originalColors(el)));

  requestAnimationFrame(() => {
    root.style.backgroundColor = rootStyle.bg;
    root.style.color = rootStyle.color;
    // màu dark mode được đặt với !important, nên đặt lại cũng phải !important
    elements.forEach((el, i) => writeColors(el, saved[i], true));
  });
}
