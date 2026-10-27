---
title: 'Học Từ Mã Nguồn Facebook: Đọc Code Minify Và 8 Kỹ Thuật Frontend Mang Đi Dùng Được'
description: 'Mở đầu series: cách đọc bundle JavaScript đã minify của facebook.com, cách hệ module __d hoạt động, và 8 kỹ thuật frontend được viết lại bằng React + TypeScript, có demo chạy ngay trong bài.'
date: '2026-10-27T09:00'
author: hunghg255
image: https://blog.hunghg.me/blogs/fb-series.png
tags: ['facebook', 'react', 'javascript', 'frontend', 'series']
---

Facebook là một trong những ứng dụng web lớn nhất thế giới, chạy hàng triệu dòng JavaScript trên đủ loại thiết bị và mạng. Họ không open-source frontend của facebook.com, nhưng **bundle JavaScript gửi xuống trình duyệt thì ai cũng tải về đọc được**. Repo [facebook-codebase](https://github.com/hunghg255/facebook-codebase) chứa vài nghìn module như vậy, tải từ bản "Comet" (bản React hiện tại của facebook.com).

Series này đi qua những module mình thấy **hay nhất và dễ mang sang dự án khác nhất**. Mỗi bài có 4 phần:

1. Facebook giải quyết vấn đề gì và giải quyết thế nào.
2. Code viết lại bằng **React 19 + TypeScript**, gọn và có comment.
3. **Demo chạy ngay trong bài**: bấm, cuộn, hover thử luôn.
4. Những bẫy và lưu ý khi đưa vào production.

> [!WARNING]
> Mã nguồn của facebook.com thuộc bản quyền của Meta và không có license cho phép tái sử dụng. Đừng copy nguyên văn vào dự án. Toàn bộ code trong series này được **viết lại từ đầu** dựa trên ý tưởng đọc được. Những phần Meta đã open-source (React, [StyleX](https://stylexjs.com), [Lexical](https://lexical.dev), [fbt](https://facebook.github.io/fbt/)) thì nên dùng bản chính thức.

## Đọc code đã minify như thế nào?

Mở một file bất kỳ trong repo, bạn sẽ thấy dạng như sau:

```js
__d("useDelayedState", ["React", "clearTimeout", "setTimeout"], (function (a, b, c, d, e, f) {
  "use strict";
  e.exports = a;
  var g = b("React");
  function a(a) {
    a = g.useState(a);
    // ...
  }
}), null);
```

Trông khó đọc, nhưng chỉ có vài quy ước cần nhớ:

| Thấy gì | Nghĩa là |
| --- | --- |
| `__d("Tên", [deps], factory)` | **define** một module. Tên module là duy nhất toàn site, không có đường dẫn file |
| `b("React")` | **require** module `React` (b = require) |
| `e.exports = ...` | `module.exports` (e = module) |
| `f.isOnline = a` | `exports.isOnline` (f = exports) |
| `!0` / `!1` / `void 0` | `true` / `false` / `undefined` |
| `this.$1`, `this.$2` | private field của class, đã bị đổi tên |
| `b("gkx")("1475760")` | **gatekeeper**: feature flag bật/tắt theo người dùng |
| `b("cr:1142206")` | **requireCond**: module được chọn lúc build tuỳ điều kiện (dev/prod, A/B test…) |
| `g._("...")` | `fbt`: chuỗi đã dịch (i18n) |

Mẹo đọc nhanh:

- **Đọc danh sách dependency trước.** `["CometMouseActivity", "JSScheduler", "setTimeout"]` đã cho biết module này làm gì với chuột, có lập lịch, có hẹn giờ.
- **Đổi tên biến khi đọc.** Copy ra editor và rename `a`, `c`, `d` thành tên có nghĩa, như khi giải đố.
- **Tìm chuỗi.** Tên lỗi, tên event, tên log (`"Network switched to offline"`) là manh mối tốt nhất.
- **Đọc nhiều lần.** Lần đầu sẽ chẳng hiểu gì. Đọc đi đọc lại vài module cùng nhóm (Toaster, Scroll…) thì sẽ quen dần.

## 8 kỹ thuật trong series

---

**Series "Học từ mã nguồn Facebook"**

- **Mở đầu: cách đọc code minify của Facebook** (bài này)
- [#1 Dùng chung IntersectionObserver + infinite scroll](/blogs/facebook-shared-intersection-observer)
- [#2 useViewportDuration: đo thời gian thực sự được xem](/blogs/facebook-use-viewport-duration)
- [#3 Preload code + data khi hover](/blogs/facebook-preload-on-hover)
- [#4 Toast manager với external store](/blogs/facebook-toast-manager)
- [#5 Network status + heartbeat backoff](/blogs/facebook-network-status-heartbeat)
- [#6 ErrorGuard: bắt lỗi theo ngữ cảnh](/blogs/facebook-error-guard)
- [#7 Banzai: gom log theo lô + sendBeacon](/blogs/facebook-batch-logger)
- [#8 Focus trap + Esc theo layer](/blogs/facebook-focus-trap)

Code + demo: [`examples/facebook-patterns`](https://github.com/hunghg255/blog-hunghg/tree/master/examples/facebook-patterns) · [Mở trên StackBlitz](https://stackblitz.com/github/hunghg255/blog-hunghg/tree/master/examples/facebook-patterns)

Tất cả demo được gom trong một project Vite nhỏ: [`examples/facebook-patterns`](https://github.com/hunghg255/blog-hunghg/tree/master/examples/facebook-patterns). Bạn có thể clone về chạy `npm install && npm run dev`, hoặc [mở trên StackBlitz](https://stackblitz.com/github/hunghg255/blog-hunghg/tree/master/examples/facebook-patterns) để sửa code ngay trên trình duyệt.

<iframe class="demo-frame" src="/demos/facebook-patterns/index.html?theme=dark" title="Demo facebook-patterns" loading="lazy" style="height: 560px"></iframe>

<p class="demo-links">▶ <a href="/demos/facebook-patterns/index.html" target="_blank" rel="noopener">Mở demo toàn màn hình ↗</a> · <a href="https://stackblitz.com/github/hunghg255/blog-hunghg/tree/master/examples/facebook-patterns" target="_blank" rel="noopener">Sửa code trên StackBlitz ↗</a></p>

## Điểm chung của 8 kỹ thuật

Đọc xong cả series, bạn sẽ thấy vài nguyên tắc Facebook lặp đi lặp lại:

- **Tách state khỏi React.** Toast, network status, logger đều là object/class thuần với `subscribe` + `getSnapshot`. React chỉ là một "view" cắm vào qua `useSyncExternalStore`. Nhờ vậy code nào cũng gọi được (`toast.push()` trong một hàm fetch chẳng hạn) và test được mà không cần render.
- **Dùng chung tài nguyên đắt.** Một IntersectionObserver cho hàng trăm element, một listener `keydown` cho mọi layer, một hàng đợi cho mọi log.
- **Không tin trình duyệt 100%.** `navigator.onLine` có thể sai. `isIntersecting` chưa có nghĩa là người dùng đang xem. `unload` thường không chạy trên mobile.
- **Đo trước, tối ưu sau.** Rất nhiều module chỉ để log: thời gian hiển thị, guard stack lúc lỗi, số lần hiện fallback.
- **Tận dụng thời gian chờ của người dùng.** Họ hover trước khi click khoảng 200–300ms. Đó là khoảng thời gian miễn phí để tải trước.

Bắt đầu với bài đầu tiên: [Shared IntersectionObserver](/blogs/facebook-shared-intersection-observer).
