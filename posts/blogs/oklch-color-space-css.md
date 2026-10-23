---
title: 'OKLCH: Không Gian Màu "Hiểu" Mắt Người Và Cách Dùng Trong CSS Hiện Đại'
description: 'Giải thích OKLCH là gì, ý nghĩa của L/C/H, vì sao nó dễ làm việc hơn HEX/RGB/HSL, cách dựng palette, gradient, dùng oklch(), color-mix(), relative color syntax và fallback cho trình duyệt cũ'
date: '2026-10-23'
author: hunghg255
image: https://blog.hunghg.me/blogs/oklch.png
tags: ['css', 'color', 'oklch', 'design-system', 'frontend']
---

# OKLCH: Không Gian Màu "Hiểu" Mắt Người Và Cách Dùng Trong CSS Hiện Đại

## **Bỏ thói quen chỉnh HEX bằng cảm tính — hãy để con số nói đúng điều mắt bạn thấy**

---

Nếu từng làm design system, chắc hẳn bạn đã gặp cảnh này: chọn được một màu xanh dương ưng ý, rồi cần thêm màu đỏ, xanh lá, vàng "cùng tông". Bạn giữ nguyên saturation và lightness trong HSL, chỉ đổi hue… và kết quả là màu vàng sáng chói còn màu xanh dương thì tối thui. Thế là lại ngồi kéo slider từng màu bằng mắt.

Vấn đề không nằm ở bạn, mà nằm ở mô hình màu. **OKLCH** sinh ra để giải quyết đúng chuyện đó.

---

## 1. OKLCH là gì?

OKLCH là cách biểu diễn màu dạng **trụ (cylindrical)** của không gian màu **OKLab** — một không gian được Björn Ottosson công bố năm 2020 với mục tiêu: *khoảng cách giữa các con số phải tương ứng với khoảng cách mà mắt người cảm nhận*. Tính chất này gọi là **perceptual uniformity** (đồng đều về mặt cảm nhận).

Nói dễ hiểu: trong OKLCH, hai màu có cùng giá trị độ sáng thì **trông** sáng như nhau. Điều mà RGB hay HSL không đảm bảo được.

Cú pháp trong CSS:

```css
.badge {
  /* oklch(Lightness Chroma Hue / Alpha) */
  background: oklch(68% 0.16 250);
  border-color: oklch(68% 0.16 250 / 40%);
}
```

---

## 2. Ba thành phần L, C, H

| Thành phần | Ý nghĩa | Giá trị |
| --- | --- | --- |
| **L** – Lightness | Độ sáng cảm nhận | `0` → `1` (hoặc `0%` → `100%`). 0 là đen, 1 là trắng |
| **C** – Chroma | Độ "đậm", độ rực của màu | Từ `0` (xám) trở lên, thực tế hiếm khi vượt `0.37` |
| **H** – Hue | Sắc độ, góc trên vòng màu | `0` → `360` độ |

Vài mốc hue để dễ nhớ (xấp xỉ): đỏ ~`25`, cam ~`55`, vàng ~`95`, xanh lá ~`145`, cyan ~`200`, xanh dương ~`260`, tím ~`300`, hồng ~`350`.

Một điểm khác HSL: **chroma không có giới hạn trên cố định**. Mỗi tổ hợp L + H có một mức chroma tối đa mà màn hình hiển thị được. Màu vàng ở độ sáng cao có thể rất rực, nhưng màu xanh dương ở cùng độ sáng thì không.

---

## 3. Vì sao HEX / RGB / HSL làm khó bạn?

- **HEX/RGB** mô tả lượng ánh sáng đỏ–lục–lam phát ra từ màn hình. Rất hợp với phần cứng, nhưng con người không nghĩ màu theo kiểu "thêm 20 đơn vị green". Muốn làm màu "nhạt hơn một chút" là phải đoán.
- **HSL** dễ đọc hơn, nhưng chữ "L" của nó là toán học chứ không phải cảm nhận. `hsl(60 100% 50%)` (vàng) và `hsl(240 100% 50%)` (xanh dương) có cùng L=50% nhưng độ sáng thực tế chênh nhau rất xa. Hệ quả:
  - Palette nhiều màu không đều nhau.
  - Tăng/giảm L để tạo shade thì hue bị "trôi" — xanh dương nhạt dần ngả tím, đậm dần thì xỉn.
  - Kiểm tra độ tương phản (contrast) gần như không thể đoán từ con số.

Với OKLCH, bạn có thể tin vào con số: **giữ L, đổi H → các màu sáng ngang nhau**; **giữ H, đổi L → cùng một sắc, chỉ sáng tối khác nhau**.

Thử so sánh nhanh:

```css
/* HSL: cùng L=50% nhưng nhìn lệch nhau rõ rệt */
.hsl-red    { background: hsl(0 80% 50%); }
.hsl-yellow { background: hsl(55 80% 50%); }
.hsl-blue   { background: hsl(230 80% 50%); }

/* OKLCH: cùng L và C, chỉ khác hue → độ sáng đồng đều */
.ok-red    { background: oklch(64% 0.17 25); }
.ok-yellow { background: oklch(64% 0.17 95); }
.ok-blue   { background: oklch(64% 0.17 260); }
```

---

## 4. Dựng palette chỉ với vài biến

Vì L và H tách bạch, bạn có thể sinh cả thang màu từ **một con số hue**:

```css
:root {
  --brand-h: 262;
  --brand-c: 0.15;

  --brand-50:  oklch(97% calc(var(--brand-c) * 0.15) var(--brand-h));
  --brand-100: oklch(93% calc(var(--brand-c) * 0.3)  var(--brand-h));
  --brand-300: oklch(80% calc(var(--brand-c) * 0.7)  var(--brand-h));
  --brand-500: oklch(62% var(--brand-c)              var(--brand-h));
  --brand-700: oklch(46% calc(var(--brand-c) * 0.85) var(--brand-h));
  --brand-900: oklch(30% calc(var(--brand-c) * 0.6)  var(--brand-h));
}

/* Đổi theme = đổi đúng một biến */
[data-theme='emerald'] { --brand-h: 160; }
[data-theme='rose']    { --brand-h: 5; }
```

Mẹo nhỏ: ở hai đầu thang (rất sáng và rất tối), hãy **giảm chroma** như ví dụ trên. Màu quá sáng hoặc quá tối không thể rực được, giữ chroma cao chỉ khiến trình duyệt phải cắt màu (gamut clipping).

Tương tự, bộ màu trạng thái (success / warning / danger / info) chỉ cần dùng chung L và C:

```css
:root {
  --status-l: 58%;
  --status-c: 0.14;
  --success: oklch(var(--status-l) var(--status-c) 150);
  --warning: oklch(var(--status-l) var(--status-c) 75);
  --danger:  oklch(var(--status-l) var(--status-c) 27);
  --info:    oklch(var(--status-l) var(--status-c) 240);
}
```

Cả bốn sẽ có "trọng lượng thị giác" gần như bằng nhau, chữ trắng đặt lên trên cũng có độ tương phản tương đương.

---

## 5. Gradient: mượt hơn, nhưng cẩn thận "đi đường vòng"

Mặc định, gradient trong CSS nội suy trong sRGB, nên đi từ xanh dương sang vàng thường có một vùng xám đục ở giữa. CSS Color 4 cho phép chọn không gian nội suy:

```css
.hero {
  /* sRGB: giữa gradient bị xám */
  background: linear-gradient(90deg, #2563eb, #facc15);
}

.hero--oklab {
  /* OKLab: đi đường thẳng, độ sáng chuyển đều */
  background: linear-gradient(in oklab 90deg, #2563eb, #facc15);
}

.hero--oklch {
  /* OKLCH: đi vòng quanh hue, màu tươi hơn */
  background: linear-gradient(in oklch 90deg, #2563eb, #facc15);
}

.rainbow {
  /* Đi hết vòng màu */
  background: linear-gradient(in oklch longer hue 90deg, oklch(70% 0.15 0), oklch(70% 0.15 0));
}
```

Lưu ý: vì hue là một vòng tròn, gradient `in oklch` có thể đi qua những màu bạn không hề khai báo (xanh dương → vàng có thể ghé qua tím/hồng hoặc xanh lá, tùy hướng). Bạn kiểm soát hướng bằng `shorter hue` (mặc định), `longer hue`, `increasing hue`, `decreasing hue`. Khi chỉ muốn chuyển màu "sạch" giữa hai điểm, `in oklab` thường là lựa chọn an toàn hơn.

---

## 6. `color-mix()` — trộn màu ngay trong CSS

Không cần Sass `lighten()`/`darken()` nữa:

```css
.btn {
  --bg: oklch(60% 0.16 262);
  background: var(--bg);
}

.btn:hover {
  /* trộn 85% màu gốc với 15% đen */
  background: color-mix(in oklch, var(--bg) 85%, black);
}

.btn--ghost {
  /* nền mờ dựa trên màu gốc */
  background: color-mix(in oklab, var(--bg) 12%, transparent);
}
```

Trộn trong `oklab`/`oklch` cho kết quả tự nhiên hơn nhiều so với trộn trong `srgb`.

---

## 7. Relative color syntax — "lấy màu này, sửa một kênh"

Đây là tính năng mình thích nhất. Cú pháp `from` cho phép phân rã một màu bất kỳ thành `l c h` rồi chỉnh từng kênh:

```css
:root {
  --accent: #7c3aed; /* đầu vào là HEX cũng được */
}

.card {
  border: 1px solid oklch(from var(--accent) l c h / 30%);   /* chỉ đổi alpha */
}

.card:hover {
  background: oklch(from var(--accent) calc(l + 0.1) c h);    /* sáng hơn 10% */
}

.card--muted {
  color: oklch(from var(--accent) l calc(c * 0.4) h);         /* bớt rực */
}

.card--complement {
  color: oklch(from var(--accent) l c calc(h + 180));         /* màu bổ túc */
}
```

Vì L là độ sáng cảm nhận, `calc(l + 0.1)` cho ra hiệu ứng "sáng hơn" nhất quán với **mọi** màu — điều mà HSL không làm được.

---

## 8. Màn hình P3 và chuyện "vượt gamut"

OKLCH không bị trói vào sRGB. Bạn có thể khai báo những màu rực hơn sRGB, và màn hình hỗ trợ **Display-P3** (đa số MacBook, iPhone, nhiều điện thoại Android cao cấp) sẽ hiển thị chúng tươi hơn thật. Màn hình chỉ có sRGB thì trình duyệt sẽ tự đưa màu về gần nhất.

```css
.cta {
  background: oklch(65% 0.2 145);
}

@media (color-gamut: p3) {
  .cta {
    background: oklch(65% 0.27 145); /* xanh lá rực hơn trên màn P3 */
  }
}
```

Nhưng đừng lạm dụng chroma: một giá trị như `oklch(70% 0.38 30)` về mặt toán học thì hợp lệ, nhưng không màn hình nào hiển thị nổi. Màu bị cắt về gamut có thể lệch khá xa thứ bạn định. Khi chọn màu, hãy dùng color picker có hiển thị ranh giới sRGB/P3 để biết chroma tối đa cho cặp L–H của mình.

Ngoài ra, màu xám (C = 0) thì giống hệt nhau ở mọi gamut, nên không cần bản P3 cho chúng.

---

## 9. Hỗ trợ trình duyệt và fallback

`oklch()` thuộc CSS Color Module Level 4 và đã chạy trên Chrome/Edge 111+, Safari 15.4+, Firefox 113+. `color-mix()` và `in oklch` cho gradient cũng đã phổ biến; relative color syntax đến muộn hơn (khoảng 2024) nên nên kiểm tra kỹ nếu phải hỗ trợ thiết bị cũ.

Cách fallback đơn giản nhất là khai báo hai lần — trình duyệt không hiểu dòng sau sẽ bỏ qua nó:

```css
.alert {
  background: #e0f2fe;
  background: oklch(95% 0.03 230);
}
```

Hoặc gom theo khối với `@supports`:

```css
:root {
  --surface: #f5f5f4;
  --text: #1c1917;
}

@supports (color: oklch(0% 0 0)) {
  :root {
    --surface: oklch(97% 0.002 75);
    --text: oklch(22% 0.006 60);
  }
}

@supports not (color: oklch(from red l c h)) {
  /* fallback riêng cho chỗ dùng relative color */
}
```

Nhớ rằng fallback không làm màu "đẹp lên" hay "xấu đi": nếu màu OKLCH nằm trong sRGB thì nó trông y hệt bản HEX tương ứng.

---

## 10. Vài mẹo khi chuyển sang OKLCH

1. **Đừng convert ồ ạt cho vui.** Hãy bắt đầu từ design token: đổi palette chính sang OKLCH, phần còn lại dùng `color-mix()`/relative color để suy ra.
2. **Dùng L để nghĩ về contrast.** Chữ trên nền: chênh lệch L khoảng `0.4–0.5` trở lên thường là an toàn, nhưng vẫn nên kiểm tra lại bằng công cụ WCAG/APCA.
3. **Chroma giảm dần ở hai đầu thang màu** để tránh clipping.
4. **Dark mode dễ hơn hẳn**: giữ hue, đảo trục L (ví dụ 97% ↔ 18%), hạ chroma nhẹ cho nền tối.
5. **Gradient hai màu → `in oklab`; gradient cầu vồng → `in oklch`.**
6. **Tailwind CSS v4** đã dùng OKLCH cho toàn bộ palette mặc định — nếu bạn đang dùng v4, bạn đã dùng OKLCH mà có khi không biết.
7. **DevTools** của Chrome/Firefox cho phép Shift+click vào ô màu để đổi qua lại giữa các định dạng, rất tiện để chuyển HEX cũ sang `oklch()`.

---

## Tổng kết

OKLCH không phải là một "định dạng màu mới cho sang", mà là cách để **con số khớp với mắt nhìn**. Khi L thật sự là độ sáng, H thật sự là sắc màu và C thật sự là độ rực, thì việc dựng palette, làm hover state, viết dark mode hay tạo gradient trở thành chuyện tính toán thay vì đoán mò.

Lần tới khi định gõ một mã HEX, hãy thử viết `oklch(...)` xem sao — rất có thể bạn sẽ không muốn quay lại nữa. 🎨
