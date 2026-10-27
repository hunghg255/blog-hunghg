/**
 * Xếp album 2–10 ảnh thành các hàng, theo thuật toán Telegram Web A dùng
 * (components/middle/message/helpers/calculateAlbumLayout.ts, port từ grouped_layout.cpp của
 * Telegram Desktop và GroupedLayout.swift của Telegram macOS):
 *
 * - 2–4 ảnh: luật viết tay theo "dáng" của từng ảnh: w (ngang, tỉ lệ > 1.2), n (dọc, < 0.8), q (vuông).
 * - Từ 5 ảnh, hoặc có ảnh rất ngang (tỉ lệ > 2): VÉT CẠN mọi cách chia 2, 3, 4 hàng, tính chiều cao
 *   mỗi hàng sao cho các ảnh vừa khít bề ngang, rồi chọn cách có tổng chiều cao gần `maxHeight` nhất
 *   (có phạt khi hàng quá thấp hoặc hàng trên đông hơn hàng dưới).
 */

export const Side = { None: 0, Top: 1, Right: 2, Bottom: 4, Left: 8 } as const;

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
  /** bitmask các cạnh chạm mép album (để bo góc đúng ảnh) */
  sides: number;
}

export interface Attempt {
  lineCounts: number[];
  heights: number[];
  totalHeight: number;
  cost: number;
  penalties: string[];
}

export type Strategy =
  | 'two-top-bottom'
  | 'two-equal'
  | 'two-left-right'
  | 'three-left'
  | 'three-top'
  | 'four-top'
  | 'four-left'
  | 'complex';

export interface AlbumLayout {
  boxes: Box[];
  width: number;
  height: number;
  strategy: Strategy;
  proportions: string;
  averageRatio: number;
  /** chỉ có với strategy 'complex': mọi phương án đã thử, kèm chi phí */
  attempts?: Attempt[];
}

export interface LayoutOptions {
  maxWidth: number;
  maxHeight?: number;
  minWidth?: number;
  spacing?: number;
  /**
   * Bản Telegram Web A tính trung bình bằng `reduce(..., 1) / n` (khởi tạo bằng 1 thay vì 0),
   * nên giá trị lệch +1/n. Bật cờ này để tái hiện đúng kết quả của bản gốc.
   */
  legacyAverage?: boolean;
}

interface Params {
  ratios: number[];
  proportions: string;
  averageRatio: number;
  maxWidth: number;
  maxHeight: number;
  minWidth: number;
  spacing: number;
}

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const sum = (list: number[]) => list.reduce((a, b) => a + b, 0);

export function getProportions(ratios: number[]) {
  return ratios.map((r) => (r > 1.2 ? 'w' : r < 0.8 ? 'n' : 'q')).join('');
}

export function calculateAlbumLayout(ratios: number[], options: LayoutOptions): AlbumLayout {
  const { maxWidth, maxHeight = maxWidth, minWidth = 100, spacing = 2, legacyAverage = false } = options;
  if (ratios.length < 2) throw new Error('Album cần ít nhất 2 ảnh');

  const proportions = getProportions(ratios);
  const averageRatio = (sum(ratios) + (legacyAverage ? 1 : 0)) / ratios.length;
  const params: Params = { ratios, proportions, averageRatio, maxWidth, maxHeight, minWidth, spacing };

  let result: { boxes: Box[]; strategy: Strategy; attempts?: Attempt[] };
  if (ratios.length >= 5 || ratios.some((r) => r > 2)) {
    result = layoutComplex(params);
  } else if (ratios.length === 2) {
    result = layoutTwo(params);
  } else if (ratios.length === 3) {
    result = proportions[0] === 'n' ? layoutThreeLeft(params) : layoutThreeTop(params);
  } else {
    result = proportions[0] === 'w' ? layoutFourTop(params) : layoutFourLeft(params);
  }

  // kích thước khung album = mép phải/dưới xa nhất
  const width = Math.max(...result.boxes.map((b) => b.x + b.width));
  const height = Math.max(...result.boxes.map((b) => b.y + b.height));
  return { ...result, width, height, proportions, averageRatio };
}

// ---------- Phương án vét cạn cho 5+ ảnh ----------

/** Liệt kê mọi cách chia `count` ảnh thành 2–4 hàng với giới hạn số ảnh mỗi hàng của Telegram. */
export function enumerateLineCounts(count: number, averageRatio: number) {
  const options: number[][] = [];
  for (let a = 1; a < count; a++) {
    const b = count - a;
    if (a <= 3 && b <= 3) options.push([a, b]);
  }
  for (let a = 1; a < count - 1; a++) {
    for (let b = 1; b < count - a; b++) {
      const c = count - a - b;
      // hàng giữa được 4 ảnh nếu album toàn ảnh dọc (ảnh dọc hẹp, xếp 4 vẫn đủ to)
      if (a <= 3 && b <= (averageRatio < 0.85 ? 4 : 3) && c <= 3) options.push([a, b, c]);
    }
  }
  for (let a = 1; a < count - 2; a++) {
    for (let b = 1; b < count - a - 1; b++) {
      for (let c = 1; c < count - a - b; c++) {
        const d = count - a - b - c;
        if (a <= 3 && b <= 3 && c <= 3 && d <= 4) options.push([a, b, c, d]);
      }
    }
  }
  return options;
}

function layoutComplex({ ratios: original, averageRatio, maxWidth, minWidth, spacing, maxHeight }: Params) {
  // ép tỉ lệ về khoảng hợp lý để một ảnh siêu ngang không làm hàng của nó mỏng như sợi chỉ
  const ratios = original.map((r) => (averageRatio > 1.1 ? clamp(r, 1, 2.75) : clamp(r, 0.6667, 1)));

  // Chiều cao hàng để các ảnh (giữ tỉ lệ) vừa khít bề ngang: h * Σratio + khoảng cách = maxWidth
  const rowHeight = (offset: number, n: number) =>
    (maxWidth - (n - 1) * spacing) / sum(ratios.slice(offset, offset + n));

  const attempts: Attempt[] = enumerateLineCounts(original.length, averageRatio).map((lineCounts) => {
    let offset = 0;
    const heights = lineCounts.map((n) => {
      const h = rowHeight(offset, n);
      offset += n;
      return h;
    });
    const totalHeight = sum(heights) + spacing * (lineCounts.length - 1);
    const penalties: string[] = [];
    let cost = Math.abs(totalHeight - maxHeight);
    if (Math.min(...heights) < minWidth) {
      cost *= 1.5;
      penalties.push(`có hàng thấp hơn ${minWidth}px`);
    }
    if (lineCounts.some((n, i) => i > 0 && lineCounts[i - 1] > n)) {
      cost *= 1.5;
      penalties.push('hàng trên đông hơn hàng dưới');
    }
    return { lineCounts, heights, totalHeight, cost, penalties };
  });

  const best = attempts.reduce((a, b) => (b.cost < a.cost ? b : a));
  const boxes: Box[] = [];
  let index = 0;
  let y = 0;
  best.lineCounts.forEach((n, row) => {
    const height = Math.round(best.heights[row]);
    let x = 0;
    for (let col = 0; col < n; col++) {
      const isLast = col === n - 1;
      // ảnh cuối hàng lấy phần bề ngang còn lại, để mép phải luôn thẳng dù đã làm tròn
      const width = isLast ? maxWidth - x : Math.round(ratios[index] * best.heights[row]);
      const sides =
        (row === 0 ? Side.Top : 0) |
        (row === best.lineCounts.length - 1 ? Side.Bottom : 0) |
        (col === 0 ? Side.Left : 0) |
        (isLast ? Side.Right : 0);
      boxes.push({ x, y, width, height, sides });
      x += width + spacing;
      index++;
    }
    y += height + spacing;
  });

  return { boxes, strategy: 'complex' as const, attempts };
}

// ---------- Luật viết tay cho 2–4 ảnh ----------

function layoutTwo(p: Params) {
  const { ratios, proportions, averageRatio, maxWidth, maxHeight, spacing, minWidth } = p;
  if (proportions === 'ww' && averageRatio > 1.4 && ratios[1] - ratios[0] < 0.2) {
    // hai ảnh ngang gần giống nhau: xếp trên-dưới
    const height = Math.round(Math.min(maxWidth / ratios[0], maxWidth / ratios[1], (maxHeight - spacing) / 2));
    return {
      strategy: 'two-top-bottom' as const,
      boxes: [
        { x: 0, y: 0, width: maxWidth, height, sides: Side.Left | Side.Top | Side.Right },
        { x: 0, y: height + spacing, width: maxWidth, height, sides: Side.Left | Side.Bottom | Side.Right },
      ],
    };
  }
  if (proportions === 'ww' || proportions === 'qq') {
    const width = (maxWidth - spacing) / 2;
    const height = Math.round(Math.min(width / ratios[0], width / ratios[1], maxHeight));
    return {
      strategy: 'two-equal' as const,
      boxes: [
        { x: 0, y: 0, width, height, sides: Side.Top | Side.Left | Side.Bottom },
        { x: width + spacing, y: 0, width, height, sides: Side.Top | Side.Right | Side.Bottom },
      ],
    };
  }
  // hai ảnh khác dáng: chia bề ngang theo tỉ lệ để cùng chiều cao, nhưng mỗi ảnh tối thiểu 40% / 1.5 minWidth
  const free = maxWidth - spacing;
  const secondWidth = Math.min(
    Math.round(Math.max(0.4 * free, free / ratios[0] / (1 / ratios[0] + 1 / ratios[1]))),
    free - Math.round(1.5 * minWidth),
  );
  const firstWidth = free - secondWidth;
  const height = Math.min(maxHeight, Math.round(Math.min(firstWidth / ratios[0], secondWidth / ratios[1])));
  return {
    strategy: 'two-left-right' as const,
    boxes: [
      { x: 0, y: 0, width: firstWidth, height, sides: Side.Top | Side.Left | Side.Bottom },
      { x: firstWidth + spacing, y: 0, width: secondWidth, height, sides: Side.Top | Side.Right | Side.Bottom },
    ],
  };
}

function layoutThreeLeft({ ratios, maxWidth, maxHeight, spacing, minWidth }: Params) {
  // ảnh đầu dọc: chiếm cột trái cao hết, hai ảnh còn lại xếp chồng bên phải
  const firstHeight = maxHeight;
  const thirdHeight = Math.round(Math.min((maxHeight - spacing) / 2, (ratios[1] * (maxWidth - spacing)) / (ratios[2] + ratios[1])));
  const secondHeight = firstHeight - thirdHeight - spacing;
  const rightWidth = Math.max(
    minWidth,
    Math.round(Math.min((maxWidth - spacing) / 2, thirdHeight * ratios[2], secondHeight * ratios[1])),
  );
  const leftWidth = Math.min(Math.round(firstHeight * ratios[0]), maxWidth - spacing - rightWidth);
  return {
    strategy: 'three-left' as const,
    boxes: [
      { x: 0, y: 0, width: leftWidth, height: firstHeight, sides: Side.Top | Side.Left | Side.Bottom },
      { x: leftWidth + spacing, y: 0, width: rightWidth, height: secondHeight, sides: Side.Top | Side.Right },
      {
        x: leftWidth + spacing,
        y: secondHeight + spacing,
        width: rightWidth,
        height: thirdHeight,
        sides: Side.Bottom | Side.Right,
      },
    ],
  };
}

function layoutThreeTop({ ratios, maxWidth, maxHeight, spacing }: Params) {
  // ảnh đầu nằm trọn hàng trên (tối đa 66% chiều cao), hai ảnh dưới chia đôi
  const firstHeight = Math.round(Math.min(maxWidth / ratios[0], 0.66 * (maxHeight - spacing)));
  const secondWidth = (maxWidth - spacing) / 2;
  const secondHeight = Math.min(
    maxHeight - firstHeight - spacing,
    Math.round(Math.min(secondWidth / ratios[1], secondWidth / ratios[2])),
  );
  const thirdWidth = maxWidth - secondWidth - spacing;
  return {
    strategy: 'three-top' as const,
    boxes: [
      { x: 0, y: 0, width: maxWidth, height: firstHeight, sides: Side.Left | Side.Top | Side.Right },
      { x: 0, y: firstHeight + spacing, width: secondWidth, height: secondHeight, sides: Side.Bottom | Side.Left },
      {
        x: secondWidth + spacing,
        y: firstHeight + spacing,
        width: thirdWidth,
        height: secondHeight,
        sides: Side.Bottom | Side.Right,
      },
    ],
  };
}

function layoutFourTop({ ratios, maxWidth, maxHeight, spacing, minWidth }: Params) {
  const h0 = Math.round(Math.min(maxWidth / ratios[0], 0.66 * (maxHeight - spacing)));
  const h = Math.round((maxWidth - 2 * spacing) / (ratios[1] + ratios[2] + ratios[3]));
  const w0 = Math.max(minWidth, Math.round(Math.min(0.4 * (maxWidth - 2 * spacing), h * ratios[1])));
  const w2 = Math.round(Math.max(minWidth, 0.33 * (maxWidth - 2 * spacing), h * ratios[3]));
  const w1 = maxWidth - w0 - w2 - 2 * spacing;
  const h1 = Math.min(maxHeight - h0 - spacing, h);
  const y = h0 + spacing;
  return {
    strategy: 'four-top' as const,
    boxes: [
      { x: 0, y: 0, width: maxWidth, height: h0, sides: Side.Left | Side.Top | Side.Right },
      { x: 0, y, width: w0, height: h1, sides: Side.Bottom | Side.Left },
      { x: w0 + spacing, y, width: w1, height: h1, sides: Side.Bottom },
      { x: w0 + w1 + 2 * spacing, y, width: w2, height: h1, sides: Side.Right | Side.Bottom },
    ],
  };
}

function layoutFourLeft({ ratios, maxWidth, maxHeight, spacing, minWidth }: Params) {
  const w0 = Math.round(Math.min(maxHeight * ratios[0], 0.6 * (maxWidth - spacing)));
  const w = Math.round((maxHeight - 2 * spacing) / (1 / ratios[1] + 1 / ratios[2] + 1 / ratios[3]));
  const h0 = Math.round(w / ratios[1]);
  const h1 = Math.round(w / ratios[2]);
  const h2 = maxHeight - h0 - h1 - 2 * spacing;
  const w1 = Math.max(minWidth, Math.min(maxWidth - w0 - spacing, w));
  const x = w0 + spacing;
  return {
    strategy: 'four-left' as const,
    boxes: [
      { x: 0, y: 0, width: w0, height: maxHeight, sides: Side.Top | Side.Left | Side.Bottom },
      { x, y: 0, width: w1, height: h0, sides: Side.Top | Side.Right },
      { x, y: h0 + spacing, width: w1, height: h1, sides: Side.Right },
      { x, y: h0 + h1 + 2 * spacing, width: w1, height: h2, sides: Side.Bottom | Side.Right },
    ],
  };
}
