---
title: 'Học từ Facebook #104: Bug định dạng số và kiểm tra dữ liệu theo locale'
description: 'Lương 25.000 ₫ hiện thành 250 ₫, bán kính 15 km lọt ngưỡng 25 km, ngày rơi về năm 126, phụ đề CRLF qua mặt validator: sáu bug nhỏ trong mã Facebook và cách sửa.'
date: '2026-10-28T11:44'
series: facebook
seriesOrder: 104
author: hunghg255
image: https://blog.hunghg.me/blogs/fb-locale-bugs.png
tags: ['facebook', 'i18n', 'intl', 'validation', 'bugs']
---

Phần lớn bug về số và dữ liệu nhập không nằm ở thuật toán khó, mà ở một dòng "hiển nhiên đúng" khi người viết thử với `en-US`, file tạo trên macOS và năm 2026. Đổi locale sang tiếng Việt, mở file phụ đề tạo trên Windows, gõ địa chỉ bằng bàn phím full-width của Nhật, và dòng đó sai.

Bài này gom sáu bug đọc được trong mã Facebook, chia ba nhóm. Mỗi bug được chạy lại bằng Node (hoặc giải thích rõ khi chỉ đọc code), kèm bản sửa và quy tắc mang về:

1. **Số tiền**: `.replace(".00", "")` để bỏ phần lẻ; chèn dấu phẩy hàng nghìn bằng tay.
2. **Điều kiện**: `a && b || c` thiếu ngoặc; `getYear()` thay vì `getFullYear()`.
3. **Văn bản**: regex `/r?\n/` thiếu dấu `\`; regex hộp thư bưu điện không chuẩn hoá Unicode.

> [!TIP]
> **Tóm tắt**
> - Đừng sửa chuỗi **sau** khi đã định dạng theo locale: dấu chấm có thể là dấu nhóm nghìn. Quyết định số chữ số lẻ **trước**, rồi để `Intl.NumberFormat` làm phần còn lại.
> - Điều kiện trộn `&&` và `||` luôn cần ngoặc hoặc toán tử ba ngôi; ngưỡng theo đơn vị nên là một bảng tra.
> - Dựng `Date` từ số (`new Date(y, m, d, h, mi)`), không từ chuỗi; `getYear()` trả về năm − 1900.
> - Tách dòng bằng `/\r\n|\r|\n/`, so thời gian bằng số; chuẩn hoá Unicode (NFKD, bỏ dấu) trước khi khớp regex với chữ người dùng gõ.

<iframe class="demo-frame" src="/demos/facebook-patterns/index.html?theme=dark#/locale-validation-bugs" title="Demo locale-validation-bugs" loading="lazy" style="height: 1000px"></iframe>

<p class="demo-links">▶ <a href="/demos/facebook-patterns/index.html#/locale-validation-bugs" target="_blank" rel="noopener">Mở demo toàn màn hình ↗</a> · <a href="https://stackblitz.com/github/hunghg255/blog-hunghg/tree/master/examples/facebook-patterns?file=src/lib/localeBugs.ts" target="_blank" rel="noopener">Sửa code trên StackBlitz ↗</a> · <a href="https://github.com/hunghg255/blog-hunghg/blob/master/examples/facebook-patterns/src/lib/localeBugs.ts" target="_blank" rel="noopener">Xem source trên GitHub ↗</a></p>

## Nhóm 1: số tiền

### Bỏ ".00" bằng `replace`: `JobsCometComposerSalaryHelpers` (`0 000A/JobsCometComposerSalaryHelpers.js`)

Khi đăng tin tuyển dụng, lương hiện dạng "25.000 ₫/giờ" hay "$25/giờ". Hàm định dạng:

```js
function formatCurrency(amount, currency) {
  return amount == null ? '' : PECurrency.formatAmountX(currency, amount * 100, {
    showDecimals: true, stripZeros: true, thousandSeparator: true,
  }).replace('.00', '');
}
```

`PECurrency.formatAmountX` (bundle `80.js`) lấy số chữ số lẻ từ bảng cấu hình tiền tệ (VND `offset: 1` → 0 chữ số, USD `offset: 100` → 2), rồi gọi `intlNumUtils.formatNumberWithThousandDelimiters`. Hàm này dùng **dấu nhóm nghìn và dấu thập phân theo locale người xem** (lấy từ `NumberFormatConsts` của locale). Với tiếng Việt, tiếng Đức, tiếng Indonesia, dấu nhóm nghìn là **dấu chấm**.

Ý định của `.replace('.00', '')` là "25.00 → 25". Nhưng `String.prototype.replace` với chuỗi chỉ thay **lần xuất hiện đầu tiên**, và không biết dấu chấm đó là gì. Kiểm bằng Node, giả định cấu hình số tiếng Việt theo CLDR (nhóm nghìn `.`, thập phân `,`):

| Số tiền, locale | Sau khi định dạng | Sau `.replace('.00', '')` |
| --- | --- | --- |
| 25 USD, en-US | `$25.00` | `$25` (đúng ý) |
| 25.000 VND, vi-VN | `25.000 ₫` | `250 ₫` |
| 1.000.000 VND, vi-VN | `1.000.000 ₫` | `10.000 ₫` |
| 25.000 USD, vi-VN | `$25.000,00` | `$250,00` |
| 1.000 USD, en-US | `$1,000.00` | `$1,000` |

Điều kiện để lỗi xảy ra: locale người xem dùng dấu chấm nhóm nghìn **và** phần nguyên có nhóm bắt đầu bằng `00` (25.000, 1.000, 300.050…). Với đồng tiền không có phần lẻ như VND thì phần `.00` bị xoá nằm trong phần nghìn; với đồng tiền có 2 chữ số lẻ thì ra kiểu `250,00`. Lương 25.000 ₫/giờ hiện thành 250 ₫/giờ: sai 100 lần, và đúng với người đọc tiếng Việt.

### Chèn dấu phẩy bằng tay: `CommerceInvoiceAdminUtil` (bundle `271.js`)

Trang tạo hoá đơn cho Page bán hàng có cặp hàm định dạng và đọc lại số tiền:

```js
function formatDollars(s) {
  const out = []; let count = 0;
  for (let i = s.length - 1; i >= 0; i--) {
    out.unshift(s[i]); count++;
    if (s[i] === '.') count = 0;                       // gặp dấu thập phân thì đếm lại
    else if (count === 3 && i !== 0) { out.unshift(','); count = 0; }
  }
  return out.join('');
}
const unformatDollars = (s) => s.replace(',', '');
```

Ba lỗi, kiểm bằng Node:

- Bộ đếm tính cả chữ số **phần lẻ**: `"1234.567"` → `"1,234.,567"`.
- Không biết dấu âm: `"-123456"` → `"-,123,456"`.
- `unformatDollars` dùng `replace` với chuỗi, chỉ xoá dấu phẩy **đầu tiên**: `"1,234,567"` → `"1234,567"`, `Number()` ra `NaN`.

Với phần lẻ 2 chữ số (`"123456.78"`) thì kết quả đúng, nên thử với số tiền đô thông thường không thấy gì. Và hàm luôn dùng dấu phẩy, bất kể locale.

## Nhóm 2: điều kiện và ngày

### `&&` và `||` không ngoặc: `adsRegulatedCategoryIsInvalidGeoLocations` (bundle `272.js`)

Quảng cáo thuộc hạng mục đặc biệt (nhà ở, việc làm, tín dụng) không được nhắm quá hẹp: bán kính quanh một điểm phải ≥ **15 dặm** hoặc ≥ **25 km** (hằng `REGULATED_CATEGORY_MIN_RADIUS_MILE = 15`, `..._KILOMETER = 25` trong `AdsRegulatedCategoryConstants`, bundle `174.js`). Điều kiện "hợp lệ" viết là:

```js
return unit === KILOMETER_UNIT && radius >= MIN_RADIUS_KILOMETER || radius >= MIN_RADIUS_MILE;
```

`&&` ưu tiên hơn `||`, nên biểu thức là `(km && r >= 25) || (r >= 15)`. Vế phải không kiểm đơn vị: **mọi** bán kính ≥ 15 đều hợp lệ, kể cả 15 km (≈ 9,3 dặm, thấp hơn mức tối thiểu). Dải 15 đến 24 km bị chấp nhận nhầm; demo tô đỏ dải đó. Đây là kiểm tra phía client, server có lẽ còn kiểm lại, nhưng người dùng sẽ thấy form "hợp lệ" rồi bị từ chối sau.

Cách sửa đúng ý: `unit === KILOMETER_UNIT ? radius >= 25 : radius >= 15`, hoặc tốt hơn là một bảng tra theo đơn vị.

### `getYear()`: `CometFormDateUtils` (`0 000A/DateRangeInput/`)

Form chọn ngày + giờ ghép hai giá trị:

```js
function getDateTimeFromDateAndTime(date, timeInSeconds) {
  return parse({ date: date.getMonth() + 1 + '/' + date.getDate() + '/' + date.getYear(), time: timeInSeconds });
}
// parse: new Date(date + ' ' + h + ':' + m + ':' + s)
```

`Date.prototype.getYear()` là API cũ trả về **năm − 1900**: năm 2026 cho `126`. Chuỗi thành `"10/28/126 9:30:0"`, và `new Date()` hiểu đó là năm 126. Node cho `Mon Oct 28 0126`. Ngay hàm bên cạnh, `getDateTimeStringFromDate`, lại dùng đúng `getFullYear()`.

Chi tiết thú vị: với năm 1999, `getYear()` trả `99`, và trình duyệt đoán `"1/5/99"` là 1999. Bug này **chỉ lộ từ năm 2000** trở đi, kiểu bug Y2K chính hiệu. Ngoài ra, định dạng `M/D/Y h:m:s` không nằm trong chuẩn ECMAScript; mỗi engine tự đoán.

## Nhóm 3: văn bản

### Phụ đề SRT: `VideoCaptionValidator` (bundle `64.js`)

Validator file phụ đề là một máy trạng thái ba bước: số thứ tự → dòng thời gian → chữ tới dòng trống, có mã lỗi 2415001 đến 2415004. Hai lỗi:

```js
const lines = text.split(/r?\n/g);   // thiếu "\" trước r
// ...
if (end <= start) error(2415004);    // so sánh hai chuỗi "hh:mm:ss,fff"
```

**`/r?\n/`** nghĩa là "chữ r tuỳ chọn, rồi xuống dòng". Với file CRLF (tạo trên Windows), mỗi dòng còn dính `\r` ở cuối, và dòng trống là `"\r"` chứ không phải `""`. Máy trạng thái chờ `""` để quay về bước "số thứ tự", nên sau block đầu tiên nó kẹt ở bước "chữ" tới hết file: **mọi block sau không được kiểm**. Chạy thử với block 1 và block "3" (sai thứ tự) có timecode ngược: file LF báo lỗi đúng; file CRLF trả `null`, tức hợp lệ. Phụ: chữ `r` ở cuối dòng bị nuốt (`"Por\nque"` thành `["Po", "que"]`), nhưng chỉ trong lúc kiểm, nội dung gửi đi vẫn nguyên.

**So sánh chuỗi**: regex cho phép giờ một chữ số (`\d{1,2}`), và `"10:00:00,000" <= "9:00:00,000"` là đúng theo thứ tự chữ (vì `"1" < "9"`), nên cue từ 9 giờ tới 10 giờ bị báo "kết thúc trước bắt đầu".

### Hộp thư bưu điện: `ShopUtils` (bundle `270.js`)

Shop trên Facebook không giao tới hộp thư bưu điện (PO Box). Kiểm bằng một regex, sau khi thay mọi ký tự ngoài `[a-z0-9\n]` bằng dấu cách:

```js
/\b(?:post(?:al)? (?:office |ofc )?bo?x|parcel (?:bo?x|locker)|po ?bo?x?|p o bo?x?|p ?o(?= ?\d))(?: ?\d| [a-z]*\d| ?$)/im
```

Regex này khá tốt: bắt "P.O. Box 123", "P.O.B. 55", "Post Office Box 9", "Parcel Locker 3", "Pobox", "PO 12", và không bắt nhầm "123 Polo Street" hay "Po Ave". Nhưng bước thay ký tự chạy trên chuỗi gốc, **không chuẩn hoá Unicode**: "Pò Box 5" (gõ nhầm dấu), "Ｐ.Ｏ. Box 7" (chữ full-width từ bộ gõ tiếng Nhật, tiếng Trung) đều lọt qua. Module còn tạo một bản `new RegExp(pattern, 'imu')` thứ hai và thử cả hai; với pattern toàn ASCII, cờ `u` không đổi gì.

```mermaid
flowchart LR
  I["Dữ liệu người dùng nhập"] --> N["Chuẩn hoá: NFKD, bỏ dấu, thường hoá, tách dòng /\r\n|\r|\n/"]
  N --> P["Phân tích ra giá trị: số, ms, ngày"]
  P --> V["Kiểm tra trên giá trị, ngưỡng theo bảng"]
  V --> F["Hiển thị: Intl theo locale người xem"]
  F -.->|"không sửa chuỗi sau bước này"| X["replace, split, so chuỗi"]
```

## Bên trong: locale, toán tử và chuỗi

**Dấu số theo locale.** CLDR (dữ liệu locale mà `Intl` dùng) quy định: `en-US` dùng `1,234.5`; `vi-VN`, `de-DE`, `id-ID`, `es-ES` dùng `1.234,5`; `fr-FR` dùng khoảng trắng hẹp không ngắt dòng (U+202F) làm dấu nhóm. `es-ES` còn không nhóm số có 4 chữ số (`1000`, nhưng `10.000`). Vì vậy mọi thao tác chuỗi giả định "dấu chấm là thập phân" đều sai với hàng trăm triệu người dùng.

**Ưu tiên toán tử.** Trong JavaScript (và C, Java, PHP), `&&` có độ ưu tiên cao hơn `||`. ESLint có luật `no-mixed-operators` để bắt đúng loại lỗi này; Prettier không tự thêm ngoặc.

**`String.prototype.replace` với chuỗi** chỉ thay lần đầu; muốn thay tất cả dùng `replaceAll` hoặc regex có cờ `g`. Đây là nguồn của hai trong sáu bug.

**`getYear`** nằm ở Phụ lục B của ECMAScript (tính năng cũ giữ lại cho web cũ). Nó vẫn chạy, không có cảnh báo nào.

**Xuống dòng.** Windows dùng `\r\n`, Unix/macOS dùng `\n`, Mac OS cổ dùng `\r`. File phụ đề, CSV tạo từ Excel, nội dung dán từ Word thường có `\r\n`. `<textarea>` luôn chuẩn hoá về `\n` khi đọc `.value`, nhưng file đọc bằng `FileReader` thì không.

**Unicode tương đương.** "Ｐ" (U+FF30, full-width) và "P" là hai ký tự khác nhau. Chuẩn hoá **NFKD** đưa dạng tương thích (full-width, chữ ghép) về dạng thường và tách dấu ra khỏi chữ ("ò" thành "o" + dấu huyền), sau đó xoá các dấu kết hợp U+0300 đến U+036F.

## Viết lại

Số tiền: quyết định số chữ số lẻ trước, không đụng vào chuỗi sau đó.

```ts title=src/lib/localeBugs.ts
/** Dấu thập phân và dấu nhóm nghìn của locale, lấy từ chính Intl. */
export function separators(locale: string) {
  const parts = new Intl.NumberFormat(locale, { useGrouping: true }).formatToParts(1234567.5);
  return {
    group: parts.find((p) => p.type === 'group')?.value ?? '',
    decimal: parts.find((p) => p.type === 'decimal')?.value ?? '.',
  };
}

/** Số chữ số lẻ chuẩn của đồng tiền (VND 0, USD 2, KWD 3). */
export const currencyDigits = (currency: string) =>
  new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;

/**
 * Định dạng tiền, bỏ phần lẻ khi nó toàn số 0 ("25 US$" chứ không "25,00 US$").
 * Không đụng vào chuỗi đã định dạng: quyết định số chữ số lẻ trước khi gọi Intl.
 */
export function formatMoney(amount: number, currency: string, locale: string) {
  const digits = currencyDigits(currency);
  const isWhole = Math.abs(amount - Math.round(amount)) < 10 ** -(digits + 1);
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: isWhole ? 0 : digits,
    maximumFractionDigits: digits,
  }).format(amount);
}
```

Nhóm nghìn khi gõ và đọc lại, theo dấu của locale:

```ts title=src/lib/localeBugs.ts
/** Chèn dấu nhóm nghìn vào chuỗi người dùng gõ (giữ nguyên phần lẻ đã gõ). */
export function groupDigits(raw: string, locale = 'en-US') {
  const { group, decimal } = separators(locale);
  const m = /^\s*([-+]?)(\d*)(?:\.(\d*))?\s*$/.exec(raw);
  if (!m) return raw; // không phải số: trả nguyên, để validator báo
  const [, sign, int, frac] = m;
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, group); // chỉ phần nguyên
  return sign + grouped + (frac !== undefined ? decimal + frac : '');
}

/** Đọc lại số đã định dạng theo locale. null nếu không hợp lệ. */
export function parseLocaleNumber(text: string, locale = 'en-US'): number | null {
  const { group, decimal } = separators(locale);
  let s = text.trim();
  // nhóm nghìn có thể là NBSP / narrow NBSP (fr-FR), xoá tất cả, không chỉ cái đầu
  for (const g of new Set([group, ' ', ' ', ' '])) if (g && g !== decimal) s = s.split(g).join('');
  if (decimal !== '.') {
    if (s.includes('.')) return null; // "1.5" trong locale dùng dấu phẩy: mơ hồ, từ chối
    s = s.replace(decimal, '.');
  }
  return /^[-+]?\d+(\.\d+)?$/.test(s) ? Number(s) : null;
}
```

Điều kiện và ngày:

```ts title=src/lib/localeBugs.ts
export type DistanceUnit = 'mile' | 'kilometer';
export const MIN_RADIUS: Record<DistanceUnit, number> = { mile: 15, kilometer: 25 };

/** Đúng: mỗi đơn vị một ngưỡng. */
export const radiusAllowed = (unit: DistanceUnit, radius: number) => radius >= MIN_RADIUS[unit];

/** Bản gốc: `unit === km && r >= 25 || r >= 15`, && ưu tiên hơn || nên km chỉ cần ≥ 15. */
export const fbRadiusAllowed = (unit: DistanceUnit, radius: number) =>
  (unit === 'kilometer' && radius >= MIN_RADIUS.kilometer) || radius >= MIN_RADIUS.mile;

/** Ghép ngày (Date) với giờ (giây từ 0h) bằng các thành phần số, không qua chuỗi. */
export function combineDateAndTime(date: Date, secondsOfDay: number) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, secondsOfDay);
}
```

Phụ đề SRT: tách dòng đủ ba kiểu, đổi timecode ra mili-giây, báo mọi lỗi kèm số dòng.

```ts title=src/lib/localeBugs.ts

const TIME = /^(\d{1,2}):(\d{1,2}):(\d{1,2})[,.](\d{1,3})$/;

/** "01:02:03,5" → ms. Phần lẻ là phần thập phân của giây: ",5" = 500 ms. */
export function parseTimecode(s: string): number | null {
  const m = TIME.exec(s.trim());
  if (!m) return null;
  const [, h, mi, se, frac] = m;
  if (+mi > 59 || +se > 59) return null;
  return ((+h * 60 + +mi) * 60 + +se) * 1000 + Math.round(+`0.${frac}` * 1000);
}

/** Kiểm tra SRT, trả về danh sách cue và mọi lỗi (kèm số dòng), không dừng ở lỗi đầu. */
export function validateSrt(text: string): { cues: SrtCue[]; problems: SrtProblem[] } {
  const lines = text.replace(/^﻿/, '').split(/\r\n|\r|\n/);
  const cues: SrtCue[] = [];
  const problems: SrtProblem[] = [];
  let expected = 1;
  let i = 0;
  const err = (code: number, line: number, message: string) => problems.push({ code, line: line + 1, message });
  while (i < lines.length) {
    if (lines[i].trim() === '') { i++; continue; }
    const idxLine = lines[i].trim();
    if (!/^\d+$/.test(idxLine)) err(SRT_ERR.BAD_INDEX, i, `"${idxLine}" không phải số thứ tự`);
    else if (+idxLine !== expected) err(SRT_ERR.WRONG_SEQUENCE, i, `cần số ${expected}, gặp ${idxLine}`);
    // đếm tiếp từ số vừa gặp để một chỗ nhảy số không kéo theo lỗi ở mọi block sau
    expected = /^\d+$/.test(idxLine) ? +idxLine + 1 : expected + 1;
    const timing = (lines[i + 1] ?? '').trim();
    const parts = timing.split(/\s+-->\s+/);
    const start = parts.length === 2 ? parseTimecode(parts[0]) : null;
    const end = parts.length === 2 ? parseTimecode(parts[1]) : null;
    if (start === null || end === null) err(SRT_ERR.BAD_TIMING_LINE, i + 1, `dòng thời gian sai: "${timing}"`);
    else if (end <= start) err(SRT_ERR.END_BEFORE_START, i + 1, 'thời điểm kết thúc không sau thời điểm bắt đầu');
    i += 2;
    const body: string[] = [];
    while (i < lines.length && lines[i].trim() !== '') body.push(lines[i++]);
    if (start !== null && end !== null) cues.push({ index: +idxLine, start, end, text: body.join('\n') });
  }
  return { cues, problems };
}
```

Hộp thư bưu điện: chuẩn hoá trước, regex sau.

```ts title=src/lib/localeBugs.ts
/** Chuẩn hoá trước khi so: NFKD (chữ full-width, chữ có dấu), bỏ dấu, thường hoá, gom ký tự lạ thành dấu cách. */
export function normalizeAddress(s: string) {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9\n]+/g, ' ')
    .trim();
}

const PO_BOX = new RegExp(
  '(?:' +
  [
    '\\bp ?[o0] ?b(?:ox)?\\b', // po box, p o b, pobox, p0 box
    '\\bpost(?:al)? (?:office |ofc )?box\\b',
    '\\bparcel (?:box|locker)\\b',
    '\\bp ?o(?= ?\\d)', // "PO 12"
    '\\bhop thu\\b', // "Hộp thư 12"
  ]
    .join('|') +
  ')(?: ?\\d| [a-z]*\\d| ?$)',
  'm',
);

/** Địa chỉ có phải hộp thư bưu điện (không giao hàng tận nơi) không. */
export const isPoBox = (address: string) => PO_BOX.test(normalizeAddress(address));
```

::: spoiler Xem toàn bộ src/lib/localeBugs.ts

```ts title=src/lib/localeBugs.ts
/**
 * Định dạng số, kiểm tra dữ liệu nhập theo locale: bản sửa của sáu bug đọc được trong
 * JobsCometComposerSalaryHelpers, CommerceInvoiceAdminUtil, adsRegulatedCategoryIsInvalidGeoLocations,
 * CometFormDateUtils, VideoCaptionValidator và ShopUtils (Facebook). Viết lại từ đầu.
 * Các hàm tiền tố `fb` mô phỏng hành vi bản gốc để so sánh.
 */

// ---------- 1. Số tiền ----------

/** Dấu thập phân và dấu nhóm nghìn của locale, lấy từ chính Intl. */
export function separators(locale: string) {
  const parts = new Intl.NumberFormat(locale, { useGrouping: true }).formatToParts(1234567.5);
  return {
    group: parts.find((p) => p.type === 'group')?.value ?? '',
    decimal: parts.find((p) => p.type === 'decimal')?.value ?? '.',
  };
}

/** Số chữ số lẻ chuẩn của đồng tiền (VND 0, USD 2, KWD 3). */
export const currencyDigits = (currency: string) =>
  new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;

/**
 * Định dạng tiền, bỏ phần lẻ khi nó toàn số 0 ("25 US$" chứ không "25,00 US$").
 * Không đụng vào chuỗi đã định dạng: quyết định số chữ số lẻ trước khi gọi Intl.
 */
export function formatMoney(amount: number, currency: string, locale: string) {
  const digits = currencyDigits(currency);
  const isWhole = Math.abs(amount - Math.round(amount)) < 10 ** -(digits + 1);
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: isWhole ? 0 : digits,
    maximumFractionDigits: digits,
  }).format(amount);
}

/** Mẫu hiển thị và số chữ số lẻ theo bảng cấu hình tiền tệ của bản gốc (offset 1 → 0 chữ số, 100 → 2). */
export const FB_CURRENCY: Record<string, { format: string; symbol: string; digits: number }> = {
  VND: { format: '{amount} {symbol}', symbol: '₫', digits: 0 },
  USD: { format: '{symbol}{amount}', symbol: '$', digits: 2 },
  EUR: { format: '{symbol} {amount}', symbol: '€', digits: 2 },
  JPY: { format: '{symbol}{amount}', symbol: '¥', digits: 0 },
};

/** Cách của bản gốc: số theo dấu của locale, ghép ký hiệu, rồi xoá chuỗi ".00" đầu tiên tìm thấy. */
export function fbFormatSalary(amount: number, currency: string, locale: string) {
  const cfg = FB_CURRENCY[currency] ?? { format: '{amount} {symbol}', symbol: currency, digits: 2 };
  const n = new Intl.NumberFormat(locale, { minimumFractionDigits: cfg.digits, maximumFractionDigits: cfg.digits }).format(amount);
  return cfg.format.replace('{symbol}', cfg.symbol).replace('{amount}', n).replace('.00', '');
}

/** Chèn dấu nhóm nghìn vào chuỗi người dùng gõ (giữ nguyên phần lẻ đã gõ). */
export function groupDigits(raw: string, locale = 'en-US') {
  const { group, decimal } = separators(locale);
  const m = /^\s*([-+]?)(\d*)(?:\.(\d*))?\s*$/.exec(raw);
  if (!m) return raw; // không phải số: trả nguyên, để validator báo
  const [, sign, int, frac] = m;
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, group); // chỉ phần nguyên
  return sign + grouped + (frac !== undefined ? decimal + frac : '');
}

/** Đọc lại số đã định dạng theo locale. null nếu không hợp lệ. */
export function parseLocaleNumber(text: string, locale = 'en-US'): number | null {
  const { group, decimal } = separators(locale);
  let s = text.trim();
  // nhóm nghìn có thể là NBSP / narrow NBSP (fr-FR), xoá tất cả, không chỉ cái đầu
  for (const g of new Set([group, ' ', ' ', ' '])) if (g && g !== decimal) s = s.split(g).join('');
  if (decimal !== '.') {
    if (s.includes('.')) return null; // "1.5" trong locale dùng dấu phẩy: mơ hồ, từ chối
    s = s.replace(decimal, '.');
  }
  return /^[-+]?\d+(\.\d+)?$/.test(s) ? Number(s) : null;
}

/** CommerceInvoiceAdminUtil.formatDollars: duyệt từ phải, cứ 3 ký tự chèn "," (đếm cả phần lẻ). */
export function fbFormatDollars(a: string) {
  const out: string[] = [];
  let count = 0;
  for (let i = a.length - 1; i >= 0; i--) {
    out.unshift(a[i]);
    count++;
    if (a[i] === '.') count = 0;
    else if (count === 3 && i !== 0) {
      out.unshift(',');
      count = 0;
    }
  }
  return out.join('');
}

/** unformatDollars: replace với chuỗi chỉ thay lần xuất hiện đầu. */
export const fbUnformatDollars = (a: string) => a.replace(',', '');

// ---------- 2. Điều kiện ----------

export type DistanceUnit = 'mile' | 'kilometer';
export const MIN_RADIUS: Record<DistanceUnit, number> = { mile: 15, kilometer: 25 };

/** Đúng: mỗi đơn vị một ngưỡng. */
export const radiusAllowed = (unit: DistanceUnit, radius: number) => radius >= MIN_RADIUS[unit];

/** Bản gốc: `unit === km && r >= 25 || r >= 15`, && ưu tiên hơn || nên km chỉ cần ≥ 15. */
export const fbRadiusAllowed = (unit: DistanceUnit, radius: number) =>
  (unit === 'kilometer' && radius >= MIN_RADIUS.kilometer) || radius >= MIN_RADIUS.mile;

/** Ghép ngày (Date) với giờ (giây từ 0h) bằng các thành phần số, không qua chuỗi. */
export function combineDateAndTime(date: Date, secondsOfDay: number) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, secondsOfDay);
}

/** Bản gốc: "M/D/" + getYear() (năm − 1900) rồi new Date(chuỗi). */
export function fbCombineDateAndTime(date: Date, secondsOfDay: number) {
  // getYear() đã bị loại khỏi chuẩn nhưng trình duyệt vẫn giữ (Annex B)
  const year = (date as Date & { getYear(): number }).getYear();
  const h = Math.floor(secondsOfDay / 3600), m = Math.floor((secondsOfDay / 60) % 60), s = secondsOfDay % 60;
  return new Date(`${date.getMonth() + 1}/${date.getDate()}/${year} ${h}:${m}:${s}`);
}

// ---------- 3. Văn bản: phụ đề SRT, hộp thư bưu điện ----------

export const SRT_ERR = { BAD_INDEX: 2415001, WRONG_SEQUENCE: 2415002, BAD_TIMING_LINE: 2415003, END_BEFORE_START: 2415004 } as const;

export interface SrtCue {
  index: number;
  start: number;
  end: number;
  text: string;
}

export interface SrtProblem {
  code: number;
  line: number;
  message: string;
}

const TIME = /^(\d{1,2}):(\d{1,2}):(\d{1,2})[,.](\d{1,3})$/;

/** "01:02:03,5" → ms. Phần lẻ là phần thập phân của giây: ",5" = 500 ms. */
export function parseTimecode(s: string): number | null {
  const m = TIME.exec(s.trim());
  if (!m) return null;
  const [, h, mi, se, frac] = m;
  if (+mi > 59 || +se > 59) return null;
  return ((+h * 60 + +mi) * 60 + +se) * 1000 + Math.round(+`0.${frac}` * 1000);
}

/** Kiểm tra SRT, trả về danh sách cue và mọi lỗi (kèm số dòng), không dừng ở lỗi đầu. */
export function validateSrt(text: string): { cues: SrtCue[]; problems: SrtProblem[] } {
  const lines = text.replace(/^﻿/, '').split(/\r\n|\r|\n/);
  const cues: SrtCue[] = [];
  const problems: SrtProblem[] = [];
  let expected = 1;
  let i = 0;
  const err = (code: number, line: number, message: string) => problems.push({ code, line: line + 1, message });
  while (i < lines.length) {
    if (lines[i].trim() === '') { i++; continue; }
    const idxLine = lines[i].trim();
    if (!/^\d+$/.test(idxLine)) err(SRT_ERR.BAD_INDEX, i, `"${idxLine}" không phải số thứ tự`);
    else if (+idxLine !== expected) err(SRT_ERR.WRONG_SEQUENCE, i, `cần số ${expected}, gặp ${idxLine}`);
    // đếm tiếp từ số vừa gặp để một chỗ nhảy số không kéo theo lỗi ở mọi block sau
    expected = /^\d+$/.test(idxLine) ? +idxLine + 1 : expected + 1;
    const timing = (lines[i + 1] ?? '').trim();
    const parts = timing.split(/\s+-->\s+/);
    const start = parts.length === 2 ? parseTimecode(parts[0]) : null;
    const end = parts.length === 2 ? parseTimecode(parts[1]) : null;
    if (start === null || end === null) err(SRT_ERR.BAD_TIMING_LINE, i + 1, `dòng thời gian sai: "${timing}"`);
    else if (end <= start) err(SRT_ERR.END_BEFORE_START, i + 1, 'thời điểm kết thúc không sau thời điểm bắt đầu');
    i += 2;
    const body: string[] = [];
    while (i < lines.length && lines[i].trim() !== '') body.push(lines[i++]);
    if (start !== null && end !== null) cues.push({ index: +idxLine, start, end, text: body.join('\n') });
  }
  return { cues, problems };
}

/** Mô phỏng VideoCaptionValidator: split(/r?\n/), so timecode bằng chuỗi, chỉ trả mã lỗi cuối. */
export function fbValidateSrt(a: string): number | null {
  let code: number | null = null, state = 0, expected = 1;
  const re = /\d{1,2}:\d{1,2}:\d{1,2}(,|\.)\d{1,3}/;
  for (const line of a.split(/r?\n/g)) {
    if (state === 0) {
      if (line.charCodeAt(0) === 0xfeff || line === '') continue;
      if (isNaN(line as unknown as number)) code = SRT_ERR.BAD_INDEX;
      else if (parseInt(line, 10) !== expected) code = SRT_ERR.WRONG_SEQUENCE;
      expected++;
      state = 1;
    } else if (state === 1) {
      const k = line.split(' ');
      if (k.length !== 3 || !re.test(k[0]) || k[1] !== '-->' || !re.test(k[2])) code = SRT_ERR.BAD_TIMING_LINE;
      else if (k[2] <= k[0]) code = SRT_ERR.END_BEFORE_START; // so sánh chuỗi
      state = 2;
    } else if (line === '') state = 0;
  }
  return code;
}

/** Chuẩn hoá trước khi so: NFKD (chữ full-width, chữ có dấu), bỏ dấu, thường hoá, gom ký tự lạ thành dấu cách. */
export function normalizeAddress(s: string) {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9\n]+/g, ' ')
    .trim();
}

const PO_BOX = new RegExp(
  '(?:' +
  [
    '\\bp ?[o0] ?b(?:ox)?\\b', // po box, p o b, pobox, p0 box
    '\\bpost(?:al)? (?:office |ofc )?box\\b',
    '\\bparcel (?:box|locker)\\b',
    '\\bp ?o(?= ?\\d)', // "PO 12"
    '\\bhop thu\\b', // "Hộp thư 12"
  ]
    .join('|') +
  ')(?: ?\\d| [a-z]*\\d| ?$)',
  'm',
);

/** Địa chỉ có phải hộp thư bưu điện (không giao hàng tận nơi) không. */
export const isPoBox = (address: string) => PO_BOX.test(normalizeAddress(address));

/** Regex của ShopUtils (trích để so sánh): chỉ thay ký tự ngoài [a-z0-9] bằng dấu cách, không chuẩn hoá Unicode. */
export function fbIsPoBox(address: string) {
  const a = address.replace(/[^a-z0-9\n]+/gi, ' ');
  return /\b(?:post(?:al)? (?:office |ofc )?bo?x|parcel (?:bo?x|locker)|po ?bo?x?|p o bo?x?|p ?o(?= ?\d))(?: ?\d| [a-z]*\d| ?$)/im.test(a);
}
```

:::

## Đi qua code

- **`separators(locale)`** hỏi chính `Intl` bằng `formatToParts(1234567.5)`: phần `group` và `decimal` là dấu thật của locale đó. Không hard-code bảng dấu.
- **`formatMoney`** kiểm "số tròn" trên **giá trị số** rồi đặt `minimumFractionDigits` là 0 hoặc số chữ số chuẩn của đồng tiền (`currencyDigits` hỏi `Intl` qua `resolvedOptions()`: VND 0, USD 2, KWD 3). Trình duyệt mới có `trailingZeroDisplay: 'stripIfInteger'` làm đúng việc này.
- **`groupDigits`** chỉ nhóm **phần nguyên** (regex `\B(?=(\d{3})+(?!\d))`), giữ nguyên dấu âm và phần lẻ người dùng đã gõ, rồi đổi dấu thập phân sang dấu của locale.
- **`parseLocaleNumber`** xoá **mọi** dấu nhóm (kể cả NBSP và U+202F của tiếng Pháp), từ chối chuỗi mơ hồ (có dấu chấm trong locale dùng dấu phẩy thập phân), rồi kiểm bằng regex trước khi `Number()`.
- **`radiusAllowed`** tra bảng `MIN_RADIUS[unit]`: thêm đơn vị mới thì TypeScript bắt buộc thêm ngưỡng.
- **`combineDateAndTime`** dùng `new Date(y, m, d, 0, 0, seconds)`: giây vượt 59 tự tràn sang phút, giờ; không có chuỗi nào được phân tích.
- **`validateSrt`** đếm số thứ tự tiếp từ số vừa gặp, để một chỗ nhảy số không kéo theo lỗi ở mọi block sau. Phần lẻ của timecode là phần thập phân của giây (`,5` = 500 ms).
- **`normalizeAddress`** thêm `đ → d` vì NFKD không tách được "đ" (nó là chữ riêng, không phải "d" + dấu). Regex mới bắt thêm "p0 box" và "hộp thư".

**Khác bản gốc:**

- Định dạng tiền bằng `Intl.NumberFormat` có `style: 'currency'`, ký hiệu và vị trí ký hiệu theo locale (bản gốc dùng bảng `format` riêng).
- Validator SRT trả về danh sách cue và mọi lỗi kèm số dòng, thay vì chỉ một mã lỗi.
- Regex PO Box viết lại, chạy trên chuỗi đã chuẩn hoá.

## Tại sao không làm cách khác?

- **`replace(/\.00$/, '')`**: khá hơn (chỉ ở cuối chuỗi), nhưng vẫn sai với locale dùng dấu phẩy thập phân (`25,00`) và với ký hiệu tiền đứng sau (`25.00 €`). Định dạng lại từ số luôn an toàn hơn sửa chuỗi.
- **`toLocaleString()` không truyền locale**: dùng locale của **máy**, không phải ngôn ngữ người dùng chọn trên Facebook. Luôn truyền locale tường minh.
- **Thư viện ngày (date-fns, Day.js)**: tránh được `getYear`, nhưng `new Date(y, m, d)` đã đủ cho việc ghép ngày giờ cục bộ; vấn đề múi giờ thì xem [bài #71 về múi giờ](/blogs/facebook-client-iana-timezone).
- **Parser SRT có sẵn** (`subtitle`, `srt-parser-2`): tốt cho việc đọc; validator riêng vẫn cần để có thông báo lỗi tiếng Việt và mã lỗi khớp server.
- **Kiểm PO Box bằng danh sách từ khoá**: dễ đọc hơn regex nhưng bắt nhầm ("Box Hill" là một vùng ở Melbourne). Regex có ràng buộc "theo sau là số" như bản gốc là lựa chọn hợp lý.

## Edge case và cạm bẫy

- **Số tiền lớn**: `Number` mất chính xác trên 2^53; tiền nên lưu theo đơn vị nhỏ nhất bằng số nguyên hoặc `BigInt` (xem [bài #49](/blogs/facebook-currency-minor-units)). `Intl.NumberFormat.format` nhận cả `BigInt` và chuỗi số.
- **Locale có chữ số riêng**: tiếng Ả Rập, Ba Tư, Hindi có thể dùng chữ số ٠١٢. `parseLocaleNumber` ở trên chỉ nhận chữ số Latin; muốn nhận cả hai thì đổi chữ số trước (bản gốc `intlNumUtils` có làm việc này).
- **Đơn vị trong dữ liệu cũ**: dữ liệu có thể là `immutable.Map` hay object thường (bản gốc xử lý cả hai). Kiểm kiểu trước khi đọc.
- **BOM** (U+FEFF) ở đầu file phụ đề UTF-8 từ Notepad: phải bỏ trước khi kiểm dòng đầu.
- **Timecode quá 99 giờ**: hiếm, nhưng regex `\d{1,2}` sẽ từ chối. Phim dài vẫn dưới 99 giờ.
- **NFKD đổi cả chữ có nghĩa**: "ﬁ" thành "fi", "²" thành "2". Chỉ dùng chuỗi đã chuẩn hoá để **so khớp**, giữ nguyên chuỗi gốc để lưu và hiển thị.

## Dùng trong dự án

```ts
import { formatMoney, parseLocaleNumber, radiusAllowed, validateSrt, isPoBox } from './localeBugs';

const locale = user.locale; // ví dụ 'vi-VN', lấy từ cài đặt người dùng, không từ máy
salaryLabel.textContent = `${formatMoney(job.wage, job.currency, locale)}/giờ`;

amountInput.addEventListener('change', () => {
  const v = parseLocaleNumber(amountInput.value, locale);
  amountInput.setCustomValidity(v === null ? 'Số tiền không hợp lệ' : '');
});

const { problems } = validateSrt(await file.text());
if (problems.length) showErrors(problems.map((p) => `Dòng ${p.line}: ${p.message}`));

if (isPoBox(address.line1)) warn('Không giao tới hộp thư bưu điện');
```

## Kiểm thử

::: spoiler Ví dụ test (bản phác, không có trong repo)

```ts
import { describe, expect, it } from 'vitest';
import {
  combineDateAndTime, fbCombineDateAndTime, fbFormatDollars, fbFormatSalary, fbRadiusAllowed, fbValidateSrt,
  formatMoney, groupDigits, isPoBox, parseLocaleNumber, radiusAllowed, validateSrt,
} from './localeBugs';

const nbsp = (s: string) => s.replace(/[  ]/g, ' ');

describe('số tiền', () => {
  it('bản gốc làm hỏng VND ở vi-VN, bản sửa thì không', () => {
    expect(fbFormatSalary(25000, 'VND', 'vi-VN')).toBe('250 ₫');
    expect(nbsp(formatMoney(25000, 'VND', 'vi-VN'))).toBe('25.000 ₫');
  });
  it('nhóm nghìn và đọc lại', () => {
    expect(fbFormatDollars('1234.567')).toBe('1,234.,567');
    expect(groupDigits('-1234567.5', 'en-US')).toBe('-1,234,567.5');
    expect(parseLocaleNumber(groupDigits('1234567.5', 'vi-VN'), 'vi-VN')).toBe(1234567.5);
    expect(parseLocaleNumber('1,234,567', 'en-US')).toBe(1234567);
  });
});

describe('điều kiện', () => {
  it('15 km không đủ', () => {
    expect(fbRadiusAllowed('kilometer', 15)).toBe(true);
    expect(radiusAllowed('kilometer', 15)).toBe(false);
    expect(radiusAllowed('mile', 15)).toBe(true);
  });
  it('năm 2026 không thành 126', () => {
    const d = new Date(2026, 9, 28);
    expect(fbCombineDateAndTime(d, 34200).getFullYear()).toBe(126);
    expect(combineDateAndTime(d, 34200)).toEqual(new Date(2026, 9, 28, 9, 30));
  });
});

describe('văn bản', () => {
  const srt = '1\n00:00:01,000 --> 00:00:02,000\nA\n\n3\n00:00:05,000 --> 00:00:04,000\nB\n';
  it('CRLF không làm validator bỏ qua block', () => {
    const crlf = srt.replace(/\n/g, '\r\n');
    expect(fbValidateSrt(crlf)).toBe(null);
    expect(validateSrt(crlf).problems.map((p) => p.code)).toEqual([2415002, 2415004]);
  });
  it('9 giờ tới 10 giờ là hợp lệ', () => {
    expect(validateSrt('1\n9:00:00,000 --> 10:00:00,000\nHi\n').problems).toEqual([]);
  });
  it('PO Box full-width và có dấu', () => {
    expect(isPoBox('Ｐ.Ｏ. Box 7')).toBe(true);
    expect(isPoBox('Pò Box 5')).toBe(true);
    expect(isPoBox('123 Polo Street')).toBe(false);
  });
});
```

:::

## So với thư viện và chuẩn web

- **`Intl.NumberFormat`** với `style: 'currency'`, `formatToParts`, `resolvedOptions`: có ở mọi trình duyệt chính. Tuỳ chọn `trailingZeroDisplay: 'stripIfInteger'` (NumberFormat v3) có ở Chrome, Firefox và Safari bản mới (tính tới 10/2026); bản viết lại không phụ thuộc vào nó.
- **Chưa có `Intl.NumberParser`**: đọc lại số theo locale vẫn phải tự làm như `parseLocaleNumber`, hoặc dùng thư viện (`@internationalized/number` của Adobe).
- **`Temporal.PlainDate` / `PlainDateTime`** (đang triển khai trên các trình duyệt, tính tới 10/2026) thay `Date` cho việc ghép ngày giờ mà không có `getYear` hay đoán chuỗi.
- **WebVTT** (`<track>`) là định dạng phụ đề chuẩn của web; trình duyệt có parser riêng và chấp nhận `\r\n`, `\r`, `\n`.
- **`String.prototype.normalize`** và **`Intl.Collator`** với `sensitivity: 'base'` là cách chuẩn để so chuỗi bỏ qua dấu.

---

Bài này thuộc series **[Học từ mã nguồn Facebook](/series/facebook)** (106 bài, đọc theo thứ tự).

::: spoiler Xem nhanh danh sách bài trong series

*Phần 1*

- [Mở đầu: cách đọc code minify của Facebook](/blogs/learn-from-facebook-source-code)
- [#1 Dùng chung IntersectionObserver + infinite scroll](/blogs/facebook-shared-intersection-observer)
- [#2 useViewportDuration: đo thời gian thực sự được xem](/blogs/facebook-use-viewport-duration)
- [#3 Preload code + data khi hover](/blogs/facebook-preload-on-hover)
- [#4 Toast manager với external store](/blogs/facebook-toast-manager)
- [#5 Network status + heartbeat backoff](/blogs/facebook-network-status-heartbeat)
- [#6 ErrorGuard: bắt lỗi theo ngữ cảnh](/blogs/facebook-error-guard)
- [#7 Banzai: gom log theo lô + sendBeacon](/blogs/facebook-batch-logger)
- [#8 Focus trap + Esc theo layer](/blogs/facebook-focus-trap)

*Phần 2*

- [#9 Mẹo calc(… * 9999): container query, line-clamp, mũi tên carousel bằng CSS](/blogs/facebook-css-9999-trick)
- [#10 Thanh cuộn tuỳ biến bằng CSS 3D](/blogs/facebook-css-3d-scrollbar)
- [#11 Modal cuộn bằng window, giữ vị trí trang nền](/blogs/facebook-document-scroll-modal)
- [#12 Popover, tooltip group và hovercard](/blogs/facebook-popover-tooltip)
- [#13 Primitive Pressable + focus-visible](/blogs/facebook-pressable)
- [#14 Tab "Xem thêm" + sticky header bằng IntersectionObserver](/blogs/facebook-priority-tabs-sticky-header)
- [#15 Avatar khoét mask, gradient Messenger, skeleton steps()](/blogs/facebook-visual-tricks)
- [#16 Khung chat không giật](/blogs/facebook-chat-scroller)
- [#17 Thuật toán chọn bố cục collage ảnh](/blogs/facebook-photo-collage-layout)
- [#18 Keep-alive tab trong SPA](/blogs/facebook-keep-alive-tabs)
- [#19 Tự đo Visual Completion & interaction tracing](/blogs/facebook-visual-completion)
- [#20 Router SPA bền bỉ & tải chunk có retry](/blogs/facebook-spa-router-resilient-loading)

*Phần 3*

- [#21 Smart Compose: gợi ý chữ mờ khi gõ](/blogs/facebook-smart-compose-ghost-text)
- [#22 MQTT ngay trong trình duyệt, tự chuyển sang long-poll](/blogs/facebook-mqtt-in-browser)
- [#23 Đo thời gian dùng bằng bitmap 64 giây](/blogs/facebook-time-spent-bitmap)
- [#24 Bảng reaction nhấn giữ rồi trượt](/blogs/facebook-reaction-press-slide)
- [#25 Tìm kiếm gấp dấu, phiên âm và highlight đầu từ](/blogs/facebook-search-diacritics-tokenize)
- [#26 Ring buffer biết trace nào đã mất log](/blogs/facebook-trace-ring-buffer)
- [#27 Engine animation JS: một vòng rAF và solver cubic-bezier](/blogs/facebook-keyframes-loop-cubic-bezier)
- [#28 Bootloader: bitmap tài nguyên đã tải, chỉ reload khi cần](/blogs/facebook-bootloader-bitmap-consistency)
- [#29 Nhận biết click do screen reader tạo ra](/blogs/facebook-virtual-cursor-detection)
- [#30 Tải trước feed theo chất lượng mạng, đoán hạng thiết bị](/blogs/facebook-network-aware-prefetch)
- [#31 Hàng đợi gửi tin chat giữ đúng thứ tự](/blogs/facebook-ordered-send-queue)
- [#32 Gộp lời gọi API trong cùng một tick](/blogs/facebook-api-batcher)
- [#33 Resize ảnh trong pool Web Worker](/blogs/facebook-jpeg-resize-worker-pool)
- [#34 Crop ảnh theo nhiều khuôn mặt](/blogs/facebook-face-aware-crop)
- [#35 Kéo-thả sắp xếp và vùng thả file không nhấp nháy](/blogs/facebook-flicker-free-drag-drop)
- [#36 Tiện ích UI: fade-out, sticky event, hàm huỷ được](/blogs/facebook-ui-utility-hooks)
- [#37 Hạ tầng nhỏ: cookie, hash lỗi, prefetch khi chuột dừng](/blogs/facebook-small-infra-cookie-hash-idle)

*Phần 4–6*

- [#38 Đồng bộ tin nhắn: phát hiện lỗ seqID và fetch bù theo tầng](/blogs/facebook-messenger-sync-seqid-gaps)
- [#39 OTID: ID tin nhắn kiểu Snowflake sinh ở client](/blogs/facebook-otid-client-snowflake)
- [#40 QPL: lấy mẫu từ lúc bắt đầu, đo RTT gửi tin đầu-cuối](/blogs/facebook-qpl-send-rtt)
- [#41 Bộ điều phối request bảy chế độ gộp và chống trùng](/blogs/facebook-request-dispatcher-modes)
- [#42 Thread list theo mốc thời gian, cookie presence có version](/blogs/facebook-threadlist-ranged-presence)
- [#43 Composer dạng plugin: reducer, dirty checker, chuỗi kiểm tra](/blogs/facebook-plugin-composer)
- [#44 Thanh toán bất đồng bộ: subscribe trước, poll dự phòng](/blogs/facebook-async-checkout)
- [#45 Validate số thẻ: sửa lỗi gõ, dải BIN, Luhn](/blogs/facebook-card-validation)
- [#46 Lịch chọn khoảng ngày: bo góc dải chọn, phím đủ bộ, RTL](/blogs/facebook-range-calendar-a11y)
- [#47 Giờ mở cửa theo tuần: qua đêm, gộp khoảng, phần bù](/blogs/facebook-weekly-hours-intervals)
- [#48 Tiến độ đăng realtime: giữ event chờ snapshot, watchdog](/blogs/facebook-realtime-publish-snapshot)
- [#49 Tiền tệ theo đơn vị nhỏ nhất và ô nhập tiền](/blogs/facebook-currency-minor-units)
- [#50 Sửa hàng loạt Empty/Uniform/Mixed, seen/read bằng 2 bit](/blogs/facebook-bulk-edit-seen-bits)
- [#51 Phát hiện script lạ hook vào hàm native](/blogs/facebook-native-hook-detection)
- [#52 localStorage tự dọn khi đầy quota](/blogs/facebook-quota-aware-storage)
- [#53 Cache tuyến do server phân giải, chờ sẵn promise](/blogs/facebook-route-cache-prefetch)
- [#54 Lưới phím mũi tên 2D và focus không làm cuộn trang](/blogs/facebook-focus-table-grid)
- [#55 Tách emoji bằng máy trạng thái](/blogs/facebook-emoji-segmentation)
- [#56 Đọc trước ghi sau trong một frame, con tự biết vị trí](/blogs/facebook-read-then-write-dom)
- [#57 Hàng đợi lệnh cho video và stream sắp lại chunk](/blogs/facebook-video-command-queue)

*Phần 7–10*

- [#58 Ước lượng băng thông EWMA: loại outlier, nhớ qua phiên](/blogs/facebook-bandwidth-ewma-estimator)
- [#59 ABR theo độ tự tin phát và cắt bậc bitrate theo MOS](/blogs/facebook-abr-playback-confidence)
- [#60 Prefetch segment dự đoán từ manifest, parse hộp sidx](/blogs/facebook-dash-predicted-segments)
- [#61 Đọc metadata MP4/MOV ngay trên client](/blogs/facebook-mp4-metadata-client)
- [#62 Upload tiếp tục được: offset, hash dedupe, phát hiện treo](/blogs/facebook-resumable-upload)
- [#63 Fenwick tree: chọn ngẫu nhiên có trọng số và offset dòng](/blogs/facebook-fenwick-weighted-random)
- [#64 Vạch trục số và trục thời gian "đẹp"](/blogs/facebook-nice-axis-ticks)
- [#65 Damerau-Levenshtein theo dải chéo và tự sửa tên gõ sai](/blogs/facebook-damerau-levenshtein)
- [#66 PRNG có seed, shuffle tái lập và lấy mẫu trace](/blogs/facebook-seeded-prng-sampling)
- [#67 Cặp min/max-heap tái dùng vị trí trong danh sách ảo](/blogs/facebook-dual-heap-buffer-set)
- [#68 Memo nhiều đối số bằng Map/WeakMap và interning object](/blogs/facebook-multikey-memo-interning)
- [#69 Thống kê cửa sổ trượt và đại số khoảng thời gian](/blogs/facebook-moving-stat-intervals)
- [#70 Int64 từ hai số 32-bit, decode UTF, offset theo code point](/blogs/facebook-int64-utf-codepoints)
- [#71 Engine múi giờ IANA trên client, phát hiện lệch giờ](/blogs/facebook-client-iana-timezone)
- [#72 Tự cài semver range](/blogs/facebook-semver-range)
- [#73 Auto-link URL, cắt chữ an toàn, giới hạn LaTeX](/blogs/facebook-autolink-safe-truncate)
- [#74 Parser query kiểu PHP chống prototype pollution](/blogs/facebook-php-query-serializer)
- [#75 Popover tự lật theo phần tràn nhỏ nhất](/blogs/facebook-popover-auto-flip)
- [#76 Tiền tố for(;;) chống JSON hijacking, đọc stream](/blogs/facebook-csrf-prefix-streaming)
- [#77 Chống lộ Referer, linkshim, xoá token trên URL](/blogs/facebook-referrer-linkshim-url-scrub)
- [#78 setImmediate bằng postMessage, gom delta chuột theo frame](/blogs/facebook-setimmediate-mouse-batching)
- [#79 Phát hiện crash qua heartbeat, dò proxy cache hỏng](/blogs/facebook-crash-heartbeat-proxy-check)
- [#80 DPR vào cookie cho ảnh @2x, che khoá trong log](/blogs/facebook-dpr-cookie-secret-redaction)
- [#81 Flux waitFor tự viết và proxy có đệm](/blogs/facebook-flux-dispatch-buffered-proxy)
- [#82 Crop đúng tỉ lệ, xoay sticker bằng ma trận](/blogs/facebook-image-crop-rotation-geometry)

*Phần 11–15*

- [#83 Chia subdomain giữa các tab bằng lease, long-poll theo bảng trạng thái](/blogs/facebook-tab-subdomain-lease-longpoll)
- [#84 MQTT QoS1: giữ publish chờ ack, gửi lại khi kết nối lại](/blogs/facebook-mqtt-qos1-republish)
- [#85 Cache Promise gộp request, cache lỗi ngắn, đua dữ liệu nhúng sẵn](/blogs/facebook-promise-cache-preload-race)
- [#86 Lịch retry: backoff có trần, Fibonacci, báo lỗi CDN mỗi N ngày](/blogs/facebook-retry-backoff-schedules)
- [#87 Giữ nguyên tham chiếu nhánh dữ liệu không đổi](/blogs/facebook-relay-recycle-nodes)
- [#88 Store optimistic: copy-on-write, rollback rồi áp lại](/blogs/facebook-relay-optimistic-store)
- [#89 Chỉ mục subscription theo record, hàng đợi task theo chiều sâu](/blogs/facebook-relay-subscription-index)
- [#90 Phân trang connection: cursor khớp đầu, edge không trùng](/blogs/facebook-relay-connection-pagination)
- [#91 Profiler kiểu middleware và memo selector có lấy mẫu kiểm tra](/blogs/facebook-profiler-middleware-memo-check)
- [#92 Đọc EBML/WebM Cues để tìm byte range của segment](/blogs/facebook-webm-ebml-cues)
- [#93 Stream HTTP Range tạm dừng được, tải tiếp đúng byte](/blogs/facebook-pausable-range-stream)
- [#94 Bảng khoảng thời gian gắn nhãn và nhảy qua lỗ buffer](/blogs/facebook-tagged-time-ranges-gaps)
- [#95 Gom chunk cho SourceBuffer, đồng bộ video bằng playbackRate](/blogs/facebook-sourcebuffer-video-sync)
- [#96 Gom tin nhắn thành cụm, vạch ngày và avatar đã xem](/blogs/facebook-message-grouping)
- [#97 Bao nhiêu tab chat vừa màn hình, chuỗi luật mở tab](/blogs/facebook-chat-tab-policy)
- [#98 Phím tắt Markdown trong editor, Backspace để hoàn tác](/blogs/facebook-markdown-shortcuts-editor)
- [#99 Offset theo code point hay UTF-16: bốn bug cùng một gốc](/blogs/facebook-codepoint-offset-bugs)
- [#100 Typeahead không nhảy: cache tiền tố, chặn reflow, khoá hover](/blogs/facebook-typeahead-stable-results)
- [#101 Hit-test trên canvas bằng phát lại path, nét đứt và cung Bézier](/blogs/facebook-canvas-hit-regions)
- [#102 Vòng tròn theo mét trên bản đồ Mercator](/blogs/facebook-mercator-meter-circles)
- [#103 Dò tính năng trình duyệt: ảnh EXIF 2×1, getter bẫy, scrollbar](/blogs/facebook-feature-probe-tricks)
- **#104 Bug định dạng số và kiểm tra dữ liệu theo locale** (bài này)
- [#105 Dispose cho đúng: idle callback, splice(-1), xoá nhầm key](/blogs/facebook-dispose-leak-bugs)

:::

Code + demo: [`examples/facebook-patterns`](https://github.com/hunghg255/blog-hunghg/tree/master/examples/facebook-patterns) · [Mở trên StackBlitz](https://stackblitz.com/github/hunghg255/blog-hunghg/tree/master/examples/facebook-patterns)
