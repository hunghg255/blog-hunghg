import type { CSSProperties } from 'react';

/**
 * Mẹo `calc((A - B) * 9999)` của Facebook: biến một phép so sánh kích thước thành một
 * "công tắc" 0 / tối đa, rồi để `min()`, `max()`, `max-width`, `min-width` kẹp lại.
 * Không có JS đo đạc, không ResizeObserver, chạy được cả khi SSR chưa hydrate.
 *
 *   A - B < 0  -> nhân 9999 thành số âm rất lớn -> bị kẹp về 0      ("tắt")
 *   A - B > 0  -> dù chỉ hơn 0.1px, nhân 9999 thành ~1000px -> bị kẹp về max ("bật")
 */

const AMPLIFY = 9999;

// ---------------------------------------------------------------------------
// 1. Bo góc card chỉ khi card KHÔNG tràn viền (CometCard)
// ---------------------------------------------------------------------------

/**
 * `border-radius` = `radius` nếu phần tử hẹp hơn viewport (trừ `gutter`), = 0 nếu tràn viền.
 *
 * Chỉ bán kính ngang được điều kiện hoá (phần trước dấu `/`): trong `border-radius`,
 * phần trăm của bán kính ngang tính theo CHIỀU RỘNG phần tử, còn của bán kính dọc tính theo
 * CHIỀU CAO. `100%` ở đây phải là chiều rộng, nên bán kính dọc để cố định. Bán kính ngang = 0
 * là đủ để góc vuông.
 */
export function radiusUnlessFullBleed(radius: number, gutter = 4): string {
  return `max(0px, min(${radius}px, calc((100vw - ${gutter}px - 100%) * ${AMPLIFY}))) / ${radius}px`;
}

// ---------------------------------------------------------------------------
// 2. "Container query" bằng chiều rộng của một phần tử đệm (BaseContainerQueryElement)
// ---------------------------------------------------------------------------

/**
 * Style cho một phần tử đệm trong flex row. `100%` của `width` = chiều rộng container.
 * - `whenAtLeast`: rộng ra (tới `maxWidth`) khi container ≥ `breakpoint`, ngược lại 0.
 * - `whenBelow`:   rộng ra khi container < `breakpoint`, ngược lại 0.
 *
 * `- 0.1` ở nhánh `whenAtLeast` để đúng bằng breakpoint cũng tính là "đủ chỗ"
 * (0.1 * 9999 ≈ 1000px > mọi maxWidth dùng trong thực tế).
 */
export function containerSwitch(
  breakpoint: number,
  mode: 'whenAtLeast' | 'whenBelow',
  maxWidth: number | string,
): CSSProperties {
  const width =
    mode === 'whenAtLeast'
      ? `calc((100% - ${breakpoint - 0.1}px) * ${AMPLIFY})`
      : `calc((${breakpoint}px - 100%) * ${AMPLIFY})`;
  return { width, minWidth: 0, maxWidth, flexShrink: 0, boxSizing: 'border-box' };
}

/** Chiều rộng cần để hiện đủ `count` avatar cỡ `size`, cách nhau `gap`. */
export function facepileBreakpoint(count: number, size: number, gap: number): number {
  return count * (size + gap) - gap;
}

/**
 * Phần tử đệm đặt TRƯỚC avatar thứ `index` (0-based) trong một hàng `overflow: hidden`.
 * Container hẹp hơn chỗ cần cho `index + 1` avatar thì phần tử đệm phình ra 100%,
 * đẩy avatar này (và mọi avatar sau) ra khỏi vùng nhìn thấy.
 */
export function facepilePusher(index: number, size: number, gap: number): CSSProperties {
  return containerSwitch(facepileBreakpoint(index + 1, size, gap), 'whenBelow', '100%');
}

// ---------------------------------------------------------------------------
// 3. Dấu "…" chỉ hiện khi chữ thật sự tràn (TetraLineClamp)
// ---------------------------------------------------------------------------

export interface OverflowEllipsisStyles {
  /** gắn vào phần tử chứa chữ (cần `position: relative; overflow: hidden`) */
  root: CSSProperties;
  /** gắn vào span "…" `position: absolute; right: 0; overflow: hidden` */
  ellipsis: CSSProperties;
}

/**
 * - root bị giới hạn `lineHeight * lines + 0.1` px.
 * - span "…" nằm ở dòng cuối, có `max-height: calc((100% - lineHeight*lines px) * 999)`.
 *   `100%` = chiều cao root. Chữ ngắn: root thấp hơn N dòng -> âm -> "…" bị kẹp về 0, ẩn.
 *   Chữ dài: root cao đúng N dòng + 0.1px -> 0.1 * 999 ≈ 100px -> "…" hiện.
 *   Đó là lý do có con số 0.1 lẻ loi: nó là "bit" phân biệt "vừa khít" với "bị cắt".
 */
export function overflowEllipsis(lineHeight: number, lines: number): OverflowEllipsisStyles {
  const full = lineHeight * lines;
  return {
    root: { maxHeight: full + 0.1 },
    ellipsis: {
      top: lineHeight * (lines - 1),
      lineHeight: `${lineHeight}px`,
      maxHeight: `calc((100% - ${full}px) * 999)`,
    },
  };
}

// ---------------------------------------------------------------------------
// 4. Mũi tên carousel chỉ hiện khi nội dung tràn (TetraishHScroll)
// ---------------------------------------------------------------------------

/**
 * Wrapper của nút mũi tên: rộng `maxWidth` khi tổng chiều rộng các thẻ > container,
 * rộng 0 (nút bị `overflow: hidden` che) khi vừa đủ chỗ.
 * Facebook chỉ dùng style này TRƯỚC lần đo đầu tiên (SSR / chưa hydrate); sau đó JS biết
 * chính xác đang ở đầu hay cuối danh sách và thay bằng trạng thái thật.
 */
export function arrowWhenOverflowing(
  itemCount: number,
  itemWidth: number,
  gap: number,
  maxWidth = 68,
): CSSProperties {
  return {
    width: `calc((${itemCount * (itemWidth + gap)}px - 100%) * ${AMPLIFY})`,
    minWidth: 0,
    maxWidth,
    overflow: 'hidden',
    flexShrink: 0,
  };
}

// ---------------------------------------------------------------------------
// 5. Cắt "leading" thừa phía trên / dưới dòng chữ (TetraText + TetraTextTypography)
// ---------------------------------------------------------------------------

/**
 * Sinh CSS cắt khoảng trống do `line-height` tạo ra phía trên chữ hoa và phía dưới baseline,
 * để khoảng cách trong code khớp đúng con số designer đo trên Figma.
 * `offsets` = [px cắt phía trên, px cắt phía dưới], phụ thuộc font + cỡ chữ + line-height
 * (Facebook ghi sẵn cho từng kiểu chữ, ví dụ body3 15/20 -> [4, 5]).
 */
export function leadingTrimCSS(selector: string, [top, bottom]: [number, number]): string {
  return [
    `${selector} { display: block; }`,
    `${selector}::before { content: ''; display: block; height: 0; margin-top: -${top}px; }`,
    `${selector}::after { content: ''; display: block; height: 0; margin-bottom: -${bottom}px; }`,
  ].join('\n');
}
