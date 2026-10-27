/**
 * Giờ gửi (meta: giờ, dấu tick, lượt xem, "đã sửa", chữ ký) nằm gọn ở góc dưới bong bóng chat,
 * không đè lên chữ và không tốn thêm một dòng khi dòng cuối còn chỗ. Telegram Web dùng hai cách:
 *
 * 1. Meta nằm NGAY TRONG đoạn text, `float: right` ở cuối: dòng cuối đủ chỗ thì nó đứng cùng dòng,
 *    thiếu chỗ thì trình duyệt tự đẩy nó xuống dòng mới. Không cần JS đo gì.
 * 2. Meta nằm ngoài đoạn text (`position: absolute`): cuối đoạn text thêm một `::after` vô hình
 *    rộng đúng bằng meta (`--meta-safe-area-size`) để giữ chỗ.
 *
 * Bề rộng meta gần như cố định (giờ + tick) nên tính bằng CSS var; chỉ chữ ký là phải đo.
 */

export interface MetaInfo {
  own?: boolean;
  hasViews?: boolean;
  wasEdited?: boolean;
  /** bề rộng chữ ký (px), đo bằng measureTextWidth */
  authorWidth?: number;
}

// Các con số lấy theo Message.scss của Telegram Web
export const META_BASE_REM = { other: 2.25, own: 3.5 } as const; // tin của mình có thêm dấu tick
export const META_EXTRA_REM = { views: 4, edited: 2.5, both: 7.5 } as const;

/** CSS var cho phần giữ chỗ: cộng ba thành phần trong CSS bằng calc(). */
export function metaSafeAreaVars({ own, hasViews, wasEdited, authorWidth = 0 }: MetaInfo) {
  let extra = 0;
  if (hasViews && wasEdited) extra = META_EXTRA_REM.both;
  else if (hasViews) extra = META_EXTRA_REM.views;
  else if (wasEdited) extra = META_EXTRA_REM.edited;
  return {
    '--meta-safe-area-base': `${own ? META_BASE_REM.own : META_BASE_REM.other}rem`,
    '--meta-safe-author-width': `${Math.ceil(authorWidth)}px`,
    '--meta-safe-area-extra-width': `${extra}rem`,
  } as Record<string, string>;
}

const widthCache = new Map<string, number>();
let measureCtx: CanvasRenderingContext2D | null | undefined;

/**
 * Đo bề rộng chữ bằng canvas.measureText. Bản gốc gán `span.innerHTML = signature` rồi đọc
 * offsetWidth: chữ ký do server/người dùng đặt nên đó là lỗ XSS (vd `<img src=x onerror=...>`),
 * và chữ có `<` `&` bị đo sai. measureText chỉ đo chuỗi, không parse HTML, không cần chạm DOM.
 */
export function measureTextWidth(text: string, font: string): number {
  const key = `${font}|${text}`;
  const cached = widthCache.get(key);
  if (cached !== undefined) return cached;
  measureCtx ??= document.createElement('canvas').getContext('2d');
  if (!measureCtx) return 0;
  measureCtx.font = font;
  const width = measureCtx.measureText(text).width;
  if (widthCache.size > 500) widthCache.clear();
  widthCache.set(key, width);
  return width;
}

/** Font của chữ ký trong meta: phải khớp với CSS thì số đo mới đúng. */
export function metaFont(element: Element) {
  const style = getComputedStyle(element);
  return `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
}
