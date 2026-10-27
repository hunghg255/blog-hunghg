/**
 * Nội suy màu bằng JS cho hai việc CSS transition làm không tốt:
 * 1. Đổi theme: mỗi màu là một biến CSS (--bg, --text…). Biến CSS thường không transition được,
 *    nên Telegram Web tự lerp từng biến trong requestAnimationFrame (src/util/switchTheme.ts).
 * 2. Nền đổi màu theo vị trí cuộn: Anchor trộn màu section hiện tại với section kế tiếp theo
 *    tỉ lệ đang hiện của section (ColorShiftContainer + SectionPositionTracker).
 */

export type Rgba = { r: number; g: number; b: number; a: number };

const HEX = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})?$/i;

export function parseHex(hex: string): Rgba {
  const m = HEX.exec(hex.trim());
  if (!m) throw new Error(`Không phải màu hex 6/8 ký tự: ${hex}`);
  return {
    r: parseInt(m[1], 16),
    g: parseInt(m[2], 16),
    b: parseInt(m[3], 16),
    // Telegram để alpha undefined khi không có; ở đây luôn có (255) để lerp giữa
    // "#rrggbb" và "#rrggbbaa" không ra NaN
    a: m[4] === undefined ? 255 : parseInt(m[4], 16),
  };
}

export const toCss = ({ r, g, b, a }: Rgba) =>
  a >= 255 ? `rgb(${Math.round(r)} ${Math.round(g)} ${Math.round(b)})` : `rgb(${Math.round(r)} ${Math.round(g)} ${Math.round(b)} / ${(a / 255).toFixed(3)})`;

export const lerp = (from: number, to: number, t: number) => from + (to - from) * t;

/** Trộn trong không gian sRGB, giống Telegram và Anchor. t = 0 → from, t = 1 → to. */
export function mixSrgb(from: Rgba, to: Rgba, t: number): Rgba {
  return { r: lerp(from.r, to.r, t), g: lerp(from.g, to.g, t), b: lerp(from.b, to.b, t), a: lerp(from.a, to.a, t) };
}

// ---- OKLab: trộn "đều mắt" hơn, ít bị xám đục ở giữa ----

const toLinear = (c: number) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const fromLinear = (v: number) => {
  const c = v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, c * 255));
};

function rgbToOklab({ r, g, b }: Rgba) {
  const [lr, lg, lb] = [toLinear(r), toLinear(g), toLinear(b)];
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    A: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    B: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

function oklabToRgb(L: number, A: number, B: number) {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return {
    r: fromLinear(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: fromLinear(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: fromLinear(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  };
}

export function mixOklab(from: Rgba, to: Rgba, t: number): Rgba {
  const a = rgbToOklab(from);
  const b = rgbToOklab(to);
  const rgb = oklabToRgb(lerp(a.L, b.L, t), lerp(a.A, b.A, t), lerp(a.B, b.B, t));
  return { ...rgb, a: lerp(from.a, to.a, t) };
}

export type MixFn = typeof mixSrgb;

// ---- 1. Chuyển theme bằng cách lerp biến CSS ----

export type Palette = Record<string, string>; // { '--bg': '#ffffff', … }

/** Easing của Telegram: 1 − (1 − t)^3.5, nhanh lúc đầu rồi chậm dần. */
export const easeOut = (t: number) => 1 - (1 - t) ** 3.5;

export interface ThemeAnimator {
  /** Chuyển sang palette mới. Đang chạy dở thì xuất phát từ màu ĐANG HIỆN, không nhảy về đầu. */
  switchTo(palette: Palette, options?: { duration?: number; animate?: boolean }): void;
  cancel(): void;
}

export function createThemeAnimator(
  target: HTMLElement,
  initial: Palette,
  { mix = mixSrgb, easing = easeOut, onFrame }: { mix?: MixFn; easing?: (t: number) => number; onFrame?: () => void } = {},
): ThemeAnimator {
  // Màu đang hiện của từng biến (cập nhật mỗi frame) → bị ngắt giữa chừng vẫn nối tiếp mượt
  const current = new Map<string, Rgba>(Object.entries(initial).map(([name, hex]) => [name, parseHex(hex)]));
  let frame = 0;

  const apply = (name: string, color: Rgba) => {
    current.set(name, color);
    target.style.setProperty(name, toCss(color));
  };
  current.forEach((color, name) => apply(name, color));

  return {
    switchTo(palette, { duration = 200, animate = true } = {}) {
      cancelAnimationFrame(frame);
      const plan = Object.entries(palette).map(([name, hex]) => ({
        name,
        from: current.get(name) ?? parseHex(hex),
        to: parseHex(hex),
      }));

      if (!animate || duration <= 0) {
        plan.forEach(({ name, to }) => apply(name, to));
        onFrame?.();
        return;
      }

      const start = performance.now();
      const step = (now: number) => {
        const t = Math.min(Math.max((now - start) / duration, 0), 1);
        const k = easing(t);
        plan.forEach(({ name, from, to }) => apply(name, mix(from, to, k)));
        onFrame?.();
        if (t < 1) frame = requestAnimationFrame(step);
      };
      frame = requestAnimationFrame(step);
    },
    cancel() {
      cancelAnimationFrame(frame);
    },
  };
}

// ---- 2. Nền đổi màu theo vị trí cuộn ----

/**
 * Tỉ lệ "đã hiện" của một section, chuẩn hoá về [0, 1].
 * Section cao hơn vùng nhìn thấy không bao giờ đạt intersectionRatio = 1
 * (tối đa chỉ là rootHeight / sectionHeight), nên phải chia cho mức tối đa đó.
 */
export function visibleRatio(entry: Pick<IntersectionObserverEntry, 'intersectionRatio' | 'boundingClientRect' | 'rootBounds'>, normalize = true) {
  if (!normalize || !entry.rootBounds) return entry.intersectionRatio;
  const max = Math.min(1, entry.rootBounds.height / entry.boundingClientRect.height);
  return Math.max(0, Math.min(1, entry.intersectionRatio / max));
}

/** Mảng ngưỡng 0, 0.01, …, 1 để IntersectionObserver báo đủ dày khi cuộn. */
export const fineThresholds = (step = 0.01) => Array.from({ length: Math.round(1 / step) + 1 }, (_, i) => +(i * step).toFixed(4));

export interface ScrollColorOptions {
  root?: Element | null;
  /** chừa phần header dính phía trên, vd "-56px 0px 0px 0px" */
  rootMargin?: string;
  mix?: MixFn;
  /** false = bỏ bước chuẩn hoá (để thấy lỗi của section cao) */
  normalize?: boolean;
}

/**
 * Theo dõi danh sách section, gọi onColor với màu trộn giữa section trên cùng đang hiện và section kế tiếp.
 * Dùng MỘT observer cho mọi section và lưu entry mới nhất của từng section trong Map:
 * không phụ thuộc closure của lần render trước như bản React của Anchor.
 */
export function trackScrollColor(
  sections: Element[],
  colors: string[],
  onColor: (color: Rgba, info: { index: number; ratio: number }) => void,
  { root = null, rootMargin = '0px', mix = mixSrgb, normalize = true }: ScrollColorOptions = {},
) {
  const parsed = colors.map(parseHex);
  const latest = new Map<number, IntersectionObserverEntry>();

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const index = sections.indexOf(entry.target);
        if (entry.isIntersecting) latest.set(index, entry);
        else latest.delete(index);
      }
      if (latest.size === 0) return;
      const index = Math.min(...latest.keys()); // section trên cùng còn hiện
      const ratio = visibleRatio(latest.get(index)!, normalize);
      const next = parsed[index + 1];
      // ratio = 1: section hiện trọn → đúng màu của nó; ratio giảm dần khi cuộn qua → nghiêng về màu kế tiếp
      const color = next ? mix(next, parsed[index], ratio) : parsed[index];
      onColor(color, { index, ratio });
    },
    { root, rootMargin, threshold: fineThresholds() },
  );

  sections.forEach((section) => observer.observe(section));
  return () => observer.disconnect();
}
