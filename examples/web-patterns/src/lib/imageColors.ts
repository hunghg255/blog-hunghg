/**
 * Lấy màu từ ảnh và chọn màu chữ:
 * - averageColor: màu trung bình của ảnh (Telegram dùng để tô nền + "pill" ngày tháng theo hình nền).
 * - patternColor: từ màu nền sinh màu cho các mảng phủ (Telegram, chuyển từ bản desktop).
 * - gradientVars: gradient 4 góc từ màu của nhiều icon (App Store web).
 * - prefersLightText: chữ trắng hay chữ đen trên một màu nền (Trello, và bản theo WCAG).
 */

export type RGB = [number, number, number];

// ---------- độ sáng và tương phản ----------

const toLinear = (channel: number) => {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

/** Relative luminance theo WCAG 2: phải đổi về ánh sáng tuyến tính trước khi cộng trọng số. Kết quả 0..1. */
export function relativeLuminance([r, g, b]: RGB): number {
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

export function contrastRatio(a: RGB, b: RGB): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * Cùng trọng số nhưng cộng thẳng trên giá trị sRGB 0..255 (chưa tuyến tính hoá). Apple và Trello đều dùng
 * công thức này và gọi là "relative luminance", thật ra là luma: đủ để SẮP XẾP màu sáng/tối, kém chính xác khi so ngưỡng.
 */
export function luma([r, g, b]: RGB): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const WHITE: RGB = [255, 255, 255];
const BLACK: RGB = [0, 0, 0];

/** Trello: luma/255 <= 0.4623475 thì dùng chữ sáng. */
export function prefersLightTextTrello(rgb: RGB): boolean {
  return luma(rgb) / 255 <= 0.4623475;
}

/**
 * Theo WCAG: chọn màu chữ cho tỉ lệ tương phản cao hơn. Hai cách cho cùng kết quả với màu xám
 * (ngưỡng của Trello gần đúng điểm xám ~117/255 nơi hai tỉ lệ bằng nhau) nhưng lệch với màu bão hoà.
 */
export function prefersLightText(rgb: RGB): boolean {
  return contrastRatio(rgb, WHITE) >= contrastRatio(rgb, BLACK);
}

// ---------- màu trung bình của ảnh ----------

export type ImageInput = HTMLImageElement | HTMLCanvasElement | ImageBitmap;

const sizeOf = (image: ImageInput) =>
  image instanceof HTMLImageElement ? { w: image.naturalWidth, h: image.naturalHeight } : { w: image.width, h: image.height };

export interface AverageOptions {
  /** thu ảnh về size × size trước khi đọc pixel; trình duyệt tự trộn khi thu nhỏ */
  size?: number;
  /** bỏ pixel gần như trong suốt (PNG có nền trong suốt sẽ không bị kéo về màu đen) */
  minAlpha?: number;
  /** trung bình trong ánh sáng tuyến tính rồi đổi lại sRGB: màu "sáng" đúng hơn khi ảnh tương phản mạnh */
  linear?: boolean;
}

/**
 * Trả về null khi canvas bị "taint": ảnh khác origin mà server không trả Access-Control-Allow-Origin,
 * hoặc <img> thiếu crossOrigin="anonymous". getImageData lúc đó ném SecurityError.
 */
export function averageColor(image: ImageInput, { size = 32, minAlpha = 125, linear = false }: AverageOptions = {}): RGB | null {
  const { w, h } = sizeOf(image);
  if (!w || !h) return null;
  // giữ tỉ lệ khung, cạnh dài = size
  const scale = Math.min(1, size / Math.max(w, h));
  const cw = Math.max(1, Math.round(w * scale));
  const ch = Math.max(1, Math.round(h * scale));
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  // thu nhỏ với chất lượng cao: trình duyệt trộn nhiều pixel nguồn thay vì lấy mẫu thưa
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, 0, 0, cw, ch);

  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(0, 0, cw, ch).data;
  } catch {
    return null;
  }

  const sum = [0, 0, 0];
  let count = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < minAlpha) continue;
    for (let c = 0; c < 3; c++) sum[c] += linear ? toLinear(data[i + c]) : data[i + c];
    count++;
  }
  if (count === 0) return null;
  const fromLinear = (v: number) => 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
  return sum.map((v) => Math.round(linear ? fromLinear(v / count) : v / count)) as RGB;
}

/**
 * Bản chuyển nguyên từ Telegram (util/colors.ts) để so sánh: vẽ ảnh ở kích thước GỐC rồi lấy 1 trong 5 pixel.
 * Telegram chỉ gọi hàm này với thumbnail data URI rất nhỏ của hình nền, nên không sao; gọi với ảnh 4000px thì tốn ~64MB.
 */
export function averageColorTelegram(image: ImageInput): RGB | null {
  const { w, h } = sizeOf(image);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(image, 0, 0);
  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(0, 0, w, h).data;
  } catch {
    return [0, 0, 0];
  }
  const blockSize = 5;
  const rgb = [0, 0, 0];
  let count = 0;
  for (let i = -4; (i += blockSize * 4) < data.length; ) {
    count++;
    rgb[0] += data[i];
    rgb[1] += data[i + 1];
    rgb[2] += data[i + 2];
  }
  return rgb.map((v) => Math.floor(v / count)) as RGB;
}

// ---------- màu cho mảng phủ trên hình nền (Telegram) ----------

/** HSV (Telegram gọi là HSB), h, s, v trong 0..1 */
export function rgbToHsv([r, g, b]: RGB): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h /= 6;
  }
  return [h, max === 0 ? 0 : d / max, max];
}

export function hsvToRgb([h, s, v]: [number, number, number]): RGB {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  const [r, g, b] = [
    [v, t, p],
    [q, v, p],
    [p, v, t],
    [p, q, v],
    [t, p, v],
    [v, p, q],
  ][((i % 6) + 6) % 6];
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

/** Bước chỉnh của Telegram: tăng độ bão hoà một chút, nền sáng thì tối đi, nền tối thì sáng lên. */
function patternHsv(rgb: RGB): [number, number, number] {
  const [h, s0, v0] = rgbToHsv(rgb);
  const s = Math.min(1, s0 + 0.05 + 0.1 * (1 - s0));
  const v = v0 > 0.5 ? Math.max(0, v0 * 0.65) : Math.max(0, Math.min(1, 1 - v0 * 0.65));
  return [h, s, v];
}

/**
 * Đúng như Telegram Web in ra: tính trong HSV nhưng ghi vào hsla(), mà hsla() là HSL.
 * "Value" của HSV bị đọc thành "lightness" của HSL, nên màu ra sáng hơn ý định của công thức.
 */
export function patternColorTelegram(rgb: RGB): string {
  const [h, s, v] = patternHsv(rgb);
  return `hsla(${h * 360}, ${s * 100}%, ${v * 100}%, .4)`;
}

/** Cùng công thức nhưng dựng màu bằng HSV -> RGB, đúng với không gian màu mà các bước chỉnh dùng. */
export function patternColor(rgb: RGB, alpha = 0.4): string {
  const [r, g, b] = hsvToRgb(patternHsv(rgb));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Màu "pill" sau khi phủ (alpha) lên nền, để tính tương phản với chữ trắng. */
export function blendOver(top: RGB, alpha: number, bottom: RGB): RGB {
  return top.map((c, i) => Math.round(c * alpha + bottom[i] * (1 - alpha))) as RGB;
}

export function parseCssColor(css: string): { rgb: RGB; alpha: number } | null {
  const probe = document.createElement('span');
  probe.style.color = css;
  if (!probe.style.color) return null;
  document.body.appendChild(probe);
  const computed = getComputedStyle(probe).color; // trình duyệt đổi hsla()/tên màu ra rgb(a)
  probe.remove();
  const m = computed.match(/[\d.]+/g);
  if (!m) return null;
  return { rgb: [Number(m[0]), Number(m[1]), Number(m[2])], alpha: m[3] === undefined ? 1 : Number(m[3]) };
}

// ---------- gradient từ nhiều màu (App Store) ----------

/** Ba kênh lệch nhau không quá threshold: xám, hoặc gần xám. */
export function isGreyish([r, g, b]: RGB, threshold = 10): boolean {
  return Math.abs(r - g) <= threshold && Math.abs(r - b) <= threshold && Math.abs(g - b) <= threshold;
}

export interface GradientOptions {
  names?: string[];
  /** bỏ màu có cả ba kênh <= ngưỡng này (gần đen), App Store dùng 33 */
  darkThreshold?: number;
  removeGreys?: boolean;
  /** App Store sắp từ tối tới sáng bằng luma: góc đầu tiên trong danh sách nhận màu tối nhất */
  sort?: 'none' | 'dark-to-light';
}

export function gradientVars(
  colors: RGB[],
  { names = ['bottom-left', 'top-right', 'bottom-right', 'top-left'], darkThreshold = 33, removeGreys = false, sort = 'dark-to-light' }: GradientOptions = {},
): Record<string, string> {
  const usable = colors
    .filter(([r, g, b]) => !(r <= darkThreshold && g <= darkThreshold && b <= darkThreshold))
    .filter((rgb) => !removeGreys || !isGreyish(rgb))
    .sort((a, b) => (sort === 'dark-to-light' ? luma(a) - luma(b) : 0))
    .slice(0, names.length);
  const vars: Record<string, string> = {};
  usable.forEach(([r, g, b], i) => {
    vars[`--${names[i]}`] = `rgb(${r}, ${g}, ${b})`;
  });
  return vars;
}

export const toHex = ([r, g, b]: RGB) => `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
