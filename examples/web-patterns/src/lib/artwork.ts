/**
 * Dựng `srcset` + `sizes` cho ảnh từ một template URL (ý tưởng từ component Artwork của
 * apps.apple.com: shared/components/src/components/Artwork/utils/srcset.ts).
 *
 * Server ảnh của Apple nhận kích thước ngay trong đường dẫn:
 *   https://is1-ssl.mzstatic.com/image/thumb/…/{w}x{h}{c}.{f}
 * Client chỉ cần thay {w} {h} {c} {f} là có ảnh đúng cỡ, không phải lưu sẵn từng bản.
 */

export type Size = 'xsmall' | 'small' | 'medium' | 'large' | 'xlarge';

/** Khoảng viewport của từng size, cùng giá trị Apple dùng (px). */
export type Breakpoints = Record<Size, { min?: number; max?: number }>;

export const APPLE_BREAKPOINTS: Breakpoints = {
  xsmall: { max: 739 },
  small: { min: 740, max: 999 },
  medium: { min: 1000, max: 1319 },
  large: { min: 1320, max: 1679 },
  xlarge: { min: 1680 },
};

/** Ảnh gốc: template URL + kích thước thật (để không xin ảnh to hơn bản gốc). */
export interface Artwork {
  template: string;
  width: number;
  height: number;
}

/**
 * "Profile" = ảnh này hiển thị rộng bao nhiêu ở từng size.
 * `widths` xếp từ xlarge xuống xsmall như Apple, profile ít phần tử thì chỉ có các size lớn.
 */
export interface Profile {
  widths: number[];
  aspectRatio: number;
  /** crop code của server ảnh Apple: 'sr' = cắt vừa khung, 'bb' = giữ nguyên, 'bf' = fill… */
  crop: string;
}

const SMALL_TO_LARGE: Size[] = ['xsmall', 'small', 'medium', 'large', 'xlarge'];
const PROFILE_ORDER: Size[] = ['xlarge', 'large', 'medium', 'small', 'xsmall'];

export interface SizeSpec {
  size: Size;
  width: number;
  height: number;
}

/** Media condition cho từng size: "(min-width:740px) and (max-width:999px)"… */
export function mediaConditions(bp: Breakpoints = APPLE_BREAKPOINTS): Record<Size, string> {
  const out = {} as Record<Size, string>;
  for (const size of SMALL_TO_LARGE) {
    const { min, max } = bp[size];
    const parts = [];
    if (min) parts.push(`(min-width:${min}px)`);
    if (max) parts.push(`(max-width:${max}px)`);
    out[size] = parts.join(' and ');
  }
  return out;
}

/**
 * Các kích thước hiển thị của profile, từ nhỏ đến lớn. Bỏ các size rộng hơn ảnh gốc;
 * nếu ảnh gốc nhỏ hơn mọi size thì giữ size nhỏ nhất (giống Apple).
 */
export function profileSizes(profile: Profile, maxWidth?: number): SizeSpec[] {
  const all = profile.widths.map((width, i) => ({
    size: PROFILE_ORDER[i],
    width,
    height: Math.round(width / profile.aspectRatio),
  }));
  all.sort((a, b) => SMALL_TO_LARGE.indexOf(a.size) - SMALL_TO_LARGE.indexOf(b.size));
  const fit = maxWidth ? all.filter((s) => s.width <= maxWidth) : all;
  return fit.length > 0 ? fit : all.slice(0, 1);
}

export interface SrcParams {
  width: number;
  height: number;
  crop?: string;
  fileType?: 'jpg' | 'webp' | 'png';
  quality?: number;
}

/** Thay placeholder trong template. Template không có {q}/{c} thì bỏ qua tham số đó. */
export function buildSrc(template: string, p: SrcParams): string {
  return template
    .replace('{w}', String(p.width))
    .replace('{h}', String(p.height))
    .replace('{c}', p.crop ?? '')
    .replace('{q}', String(p.quality ?? 60))
    .replace('{f}', p.fileType ?? 'jpg');
}

export interface SrcsetOptions {
  fileType?: SrcParams['fileType'];
  quality?: number;
  /** mật độ điểm ảnh cần hỗ trợ; Apple cố định [1, 2] thay vì đọc devicePixelRatio */
  densities?: number[];
}

/**
 * srcset dạng "url 490w, url 920w, …": mỗi size × mỗi mật độ một ứng viên.
 * Không xin ảnh rộng hơn bản gốc (trừ crop 'bf' = server tự fill), loại trùng bằng Map theo độ rộng.
 */
export function buildSrcset(artwork: Artwork, profile: Profile, opts: SrcsetOptions = {}): string {
  const { densities = [1, 2], fileType, quality } = opts;
  const candidates = new Map<number, string>();
  for (const density of densities) {
    for (const spec of profileSizes(profile, artwork.width)) {
      const wanted = Math.ceil(spec.width * density);
      const width = profile.crop === 'bf' ? wanted : Math.min(wanted, artwork.width);
      const height = Math.round((width * spec.height) / spec.width);
      const url = buildSrc(artwork.template, { width, height, crop: profile.crop, fileType, quality });
      candidates.set(width, `${url} ${width}w`);
    }
  }
  return [...candidates.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, candidate]) => candidate)
    .join(', ');
}

/**
 * sizes: báo cho trình duyệt biết ảnh sẽ rộng bao nhiêu ở từng viewport, TRƯỚC khi có CSS.
 * Size nhỏ nhất chỉ giữ max-width (không có min, nếu không viewport hẹp hơn sẽ rơi xuống
 * mục cuối = ảnh to nhất); mục cuối không có điều kiện (giá trị mặc định).
 */
export function buildSizes(profile: Profile, maxWidth?: number, bp: Breakpoints = APPLE_BREAKPOINTS) {
  const conditions = mediaConditions(bp);
  const specs = profileSizes(profile, maxWidth);
  return specs
    .map(({ size, width }, i) => {
      if (i === specs.length - 1) return `${width}px`;
      const condition = i === 0 && bp[size].max ? `(max-width:${bp[size].max}px)` : conditions[size];
      return `${condition} ${width}px`;
    })
    .join(', ');
}

// ---- Mô phỏng trình duyệt chọn ứng viên (để demo giải thích) ----

/** Đánh giá chuỗi sizes cho một viewport, trả về độ rộng slot (px). */
export function evaluateSizes(sizes: string, viewportWidth: number): number {
  for (const entry of sizes.split(',').map((s) => s.trim())) {
    const match = entry.match(/^(.*?)\s*(\d+)px$/);
    if (!match) continue;
    const [, condition, px] = match;
    const ok = [...condition.matchAll(/\((min|max)-width:(\d+)px\)/g)].every(([, kind, value]) =>
      kind === 'min' ? viewportWidth >= +value : viewportWidth <= +value,
    );
    if (ok) return +px;
  }
  return viewportWidth; // sizes không hợp lệ -> trình duyệt coi như 100vw
}

/**
 * Quy tắc đơn giản: ứng viên nhỏ nhất có độ rộng ≥ slot × DPR, không có thì lấy to nhất.
 * Trình duyệt thật được phép chọn khác (vd dùng ảnh to hơn đã có trong cache).
 */
export function pickCandidate(srcset: string, slotWidth: number, dpr: number) {
  const list = srcset.split(', ').map((c) => {
    const [url, w] = c.split(' ');
    return { url, width: parseInt(w, 10) };
  });
  const need = slotWidth * dpr;
  return list.find((c) => c.width >= need) ?? list[list.length - 1];
}
