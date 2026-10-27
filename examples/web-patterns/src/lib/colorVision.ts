/**
 * Giả lập cách người khiếm thị màu nhìn giao diện, ý tưởng từ menu a11y nội bộ của Trello
 * (packages/a11y/src/AccessibilityMenu/ToggleColorVision.tsx). Ma trận màu Trello lấy từ
 * mã nguồn Chromium (vision_deficiency.cc), cũng là thứ DevTools dùng cho
 * "Rendering → Emulate vision deficiencies".
 *
 * Trello nhét cả thẻ <svg><filter> vào CSS dưới dạng data URI:
 *   #trello-root { filter: url('data:image/svg+xml,<svg …><filter id="x">…</filter></svg>#x') }
 * Bản này chèn một <svg> ẩn vào trang rồi dùng filter: url(#id), cách tham chiếu filter
 * cùng tài liệu mà mọi trình duyệt đều hỗ trợ, và tạo filter một lần thay vì mỗi lần render.
 */

export type VisionMode = 'achromatopsia' | 'blurred' | 'deuteranopia' | 'protanopia' | 'tritanopia';

/** Ma trận 3×3 (phần RGB của feColorMatrix 4×5; cột alpha và offset đều là 0). */
export const MATRICES: Record<Exclude<VisionMode, 'blurred'>, number[]> = {
  // không thấy màu: chỉ còn độ sáng (hệ số Rec. 709)
  achromatopsia: [0.213, 0.715, 0.072, 0.213, 0.715, 0.072, 0.213, 0.715, 0.072],
  // thiếu tế bào nón xanh lá (phổ biến nhất)
  deuteranopia: [0.367, 0.861, -0.228, 0.28, 0.673, 0.047, -0.012, 0.043, 0.969],
  // thiếu tế bào nón đỏ
  protanopia: [0.152, 1.053, -0.205, 0.115, 0.786, 0.099, -0.004, -0.048, 1.052],
  // thiếu tế bào nón xanh dương (hiếm)
  tritanopia: [1.256, -0.077, -0.179, -0.078, 0.931, 0.148, 0.005, 0.691, 0.304],
};

export const VISION_LABELS: Record<VisionMode, string> = {
  achromatopsia: 'Achromatopsia (không thấy màu)',
  blurred: 'Nhìn mờ',
  deuteranopia: 'Deuteranopia (mù màu xanh lá)',
  protanopia: 'Protanopia (mù màu đỏ)',
  tritanopia: 'Tritanopia (mù màu xanh dương)',
};

/** Phần tử bên trong <filter> cho từng chế độ. */
export function filterPrimitive(mode: VisionMode): string {
  if (mode === 'blurred') return '<feGaussianBlur stdDeviation="2" />';
  const m = MATRICES[mode];
  const values = [...m.slice(0, 3), 0, 0, ...m.slice(3, 6), 0, 0, ...m.slice(6, 9), 0, 0, 0, 0, 0, 1, 0];
  return `<feColorMatrix type="matrix" values="${values.join(' ')}" />`;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const DEFS_ID = 'color-vision-filters';
export const filterId = (mode: VisionMode) => `cv-${mode}`;

/** Chèn (một lần) một <svg> ẩn chứa đủ 5 filter vào cuối <body>. */
export function ensureFilters(doc: Document = document) {
  if (doc.getElementById(DEFS_ID)) return;
  const svg = doc.createElementNS(SVG_NS, 'svg');
  svg.id = DEFS_ID;
  svg.setAttribute('aria-hidden', 'true');
  // width/height 0 + absolute: không chiếm chỗ. Không dùng display:none: tài nguyên SVG
  // (filter, gradient) nằm trong cây bị display:none có thể không được áp.
  svg.setAttribute('style', 'position:absolute;width:0;height:0;overflow:hidden');
  svg.innerHTML = (Object.keys(VISION_LABELS) as VisionMode[])
    .map((mode) => `<filter id="${filterId(mode)}" color-interpolation-filters="linearRGB">${filterPrimitive(mode)}</filter>`)
    .join('');
  doc.body.appendChild(svg);
}

/** Áp (hoặc bỏ, khi mode = null) giả lập lên một phần tử. */
export function applyColorVision(target: HTMLElement, mode: VisionMode | null) {
  if (!mode) {
    target.style.removeProperty('filter');
    return;
  }
  ensureFilters(target.ownerDocument);
  target.style.filter = `url(#${filterId(mode)})`;
}

/** Cách của Trello: filter nằm trong data URI. Giữ lại để so sánh trong demo. */
export function dataUriFilter(mode: VisionMode, id = 'f') {
  const svg = `<svg xmlns="${SVG_NS}"><filter id="${id}" color-interpolation-filters="linearRGB">${filterPrimitive(mode)}</filter></svg>`;
  // encode để không vướng ký tự # < > " trong URL
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}#${id}")`;
}

// ---- Tính trước trong JS: màu nào sẽ "đụng" nhau? ----

export type Rgb = [number, number, number];

const toLinear = (c: number) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const fromLinear = (v: number) => {
  const x = Math.max(0, Math.min(1, v));
  return Math.round((x <= 0.0031308 ? x * 12.92 : 1.055 * x ** (1 / 2.4) - 0.055) * 255);
};

export function hexToRgb(hex: string): Rgb {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Áp ma trận lên một màu, làm trong không gian tuyến tính (linearRGB): đúng như filter SVG ở trên
 * (color-interpolation-filters="linearRGB", cũng là giá trị mặc định theo spec).
 */
export function simulate(rgb: Rgb, mode: Exclude<VisionMode, 'blurred'>): Rgb {
  const m = MATRICES[mode];
  const [r, g, b] = rgb.map(toLinear);
  return [
    fromLinear(m[0] * r + m[1] * g + m[2] * b),
    fromLinear(m[3] * r + m[4] * g + m[5] * b),
    fromLinear(m[6] * r + m[7] * g + m[8] * b),
  ];
}

/** Khoảng cách màu trong OKLab (≈ khác biệt cảm nhận). Ngưỡng "khó phân biệt" là tự chọn, không phải chuẩn. */
export function oklabDistance(a: Rgb, b: Rgb) {
  const lab = (rgb: Rgb) => {
    const [r, g, bl] = rgb.map(toLinear);
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * bl);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * bl);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * bl);
    return [
      0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
      1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
      0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
    ];
  };
  const [L1, A1, B1] = lab(a);
  const [L2, A2, B2] = lab(b);
  return Math.hypot(L1 - L2, A1 - A2, B1 - B2);
}

export interface Collision {
  a: string;
  b: string;
  before: number;
  after: number;
}

/** Các cặp màu trong palette trở nên khó phân biệt dưới một chế độ khiếm thị. */
export function findCollisions(
  palette: Record<string, string>,
  mode: Exclude<VisionMode, 'blurred'>,
  threshold = 0.08,
): Collision[] {
  const names = Object.keys(palette);
  const result: Collision[] = [];
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const a = hexToRgb(palette[names[i]]);
      const b = hexToRgb(palette[names[j]]);
      const after = oklabDistance(simulate(a, mode), simulate(b, mode));
      if (after < threshold) result.push({ a: names[i], b: names[j], before: oklabDistance(a, b), after });
    }
  }
  return result.sort((x, y) => x.after - y.after);
}
