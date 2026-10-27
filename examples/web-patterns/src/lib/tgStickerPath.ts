/**
 * Viền sticker nén thành bytes (PhotoPathSize của Telegram) ⇄ SVG path.
 *
 * Mỗi byte là một token:
 * - byte ≥ 192: một ký tự tra trong bảng LOOKUP 64 ký tự (lệnh path, '.', chữ số, '-', ',')
 * - 128–191:   ',' + (byte & 63)   → số 0–63 đứng sau dấu phẩy
 * - 64–127:    '-' + (byte & 63)   → số âm 0–63
 * - < 64:      số 0–63
 * Path luôn bắt đầu bằng 'M' và kết thúc bằng 'z' nên hai ký tự đó không cần lưu.
 */

// Vị trí = mã ký tự - 'A' (chữ hoa) hoặc 26 + (mã - 'a') (chữ thường); ô không dùng điền 'A'/'a'.
// Có hai chỗ lạ: vị trí của 'x' là '.', của 'y' là 'a'.
const LOOKUP = 'AACAAAAHAAALMAAAQASTAVAAAZaacaaaahaaalmaaaqastava.az0123456789-,';

export function decodePathBytes(bytes: Uint8Array): string {
  let path = 'M';
  for (const byte of bytes) {
    if (byte >= 192) {
      path += LOOKUP[byte - 192];
    } else {
      if (byte >= 128) path += ',';
      else if (byte >= 64) path += '-';
      path += String(byte & 63);
    }
  }
  return `${path}z`;
}

/**
 * Chiều ngược lại (Telegram không cần vì server đã mã hoá sẵn). Dùng cho demo và test:
 * số nguyên 0–63 (có thể kèm ',' hoặc '-' đứng trước) gói vào 1 byte, còn lại mỗi ký tự 1 byte.
 */
export function encodePath(path: string): Uint8Array {
  const body = normalizePath(path).replace(/^M/, '').replace(/z$/, '');
  const out: number[] = [];
  const re = /([,-]?)(\d+)|(.)/g;
  for (let match = re.exec(body); match; match = re.exec(body)) {
    const [, sign, digits, char] = match;
    if (digits !== undefined) {
      const value = Number(digits);
      // số lớn hơn 63 hoặc có số 0 ở đầu (vd "05") phải viết từng chữ số để giải mã ra đúng chuỗi
      if (value <= 63 && String(value) === digits) {
        out.push((sign === ',' ? 128 : sign === '-' ? 64 : 0) + value);
        continue;
      }
      for (const c of sign + digits) out.push(lookupByte(c));
      continue;
    }
    out.push(lookupByte(char));
  }
  return new Uint8Array(out);
}

function lookupByte(char: string) {
  // lần xuất hiện đầu tiên luôn là vị trí đúng: 'A' ở 0, 'a' ở 26, các ô trống đứng sau
  const index = LOOKUP.indexOf(char);
  if (index === -1) throw new SyntaxError(`Ký tự "${char}" không có trong bảng`);
  return 192 + index;
}

/** Bỏ khoảng trắng: số liền nhau ngăn bằng ',' (bảng không có ký tự cách). */
export function normalizePath(path: string) {
  return path
    .trim()
    .replace(/\s*([A-Za-z])\s*/g, '$1')
    .replace(/\s+-/g, '-')
    .replace(/\s+/g, ',')
    .replace(/Z$/, 'z'); // định dạng luôn kết thúc bằng 'z' thường
}

export function pathToSvgDataUri(path: string, width: number, height: number) {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">` +
    `<path fill-opacity="0.1" d="${path}"/></svg>`;
  // encodeURIComponent: Telegram nhét thẳng chuỗi vào "data:image/svg+xml;utf8,…" — chạy được vì path
  // không có '#' hay '%', nhưng mã hoá đầy đủ thì an toàn hơn
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
