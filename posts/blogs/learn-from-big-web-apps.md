---
title: 'Học từ mã nguồn các web lớn: đọc code production của 28 trang web'
description: 'Mở đầu series: repo codebase chứa source của 28 web app lớn, cách đọc code production, phân biệt code nhà với thư viện, và lộ trình 64 bài kèm demo.'
date: '2026-10-27T12:00'
series: web
seriesOrder: 0
author: hunghg255
image: https://blog.hunghg.me/blogs/web-series.png
tags: ['web-patterns', 'javascript', 'react', 'source-code', 'architecture']
---

Tài liệu frontend thường dạy ta cách *dùng* một API. Còn chuyện một đội lớn ghép các API đó lại thế nào khi có hàng triệu người dùng, mạng chập chờn, mười tab mở cùng lúc, và bản deploy mới ra mỗi ngày, thì hiếm ai viết ra. Câu trả lời nằm sẵn trong code mà trình duyệt của bạn tải về mỗi lần mở Telegram, App Store hay Trello.

Series [Học từ mã nguồn Facebook](/series/facebook) đã làm việc này với một site. Series này mở rộng ra **28 web app khác**: Telegram, Apple App Store, HubSpot, Trello, Zappos, Outlook, Coursera, Intercom… Mỗi bài chọn một kỹ thuật, đọc code gốc để hiểu họ làm gì và tại sao, rồi viết lại bằng React + TypeScript kèm demo chạy ngay trong bài.

> [!TIP]
> **Tóm tắt**
> - Repo [hunghg255/codebase](https://github.com/hunghg255/codebase) lưu source front-end (đa phần dựng lại từ source map) của 28 web app lớn, cộng thêm Facebook.
> - Đọc code production: tách code nhà khỏi thư viện vendored trước, rồi lần theo chuỗi văn bản, tên API trình duyệt và tên file.
> - Series có 64 bài trong 13 phần: trải nghiệm người dùng, hiệu năng và đo lường, nhiều tab và cập nhật, kiến trúc, soạn thảo và hiển thị nội dung, tương tác, mạng và async, hiệu năng và vận hành, thuật toán phía client, thời gian và ngôn ngữ, giao diện, media, đo lường và bảo mật.
> - Học ý tưởng, viết lại code từ đầu. Toàn bộ code mẫu ở `examples/web-patterns` trong repo blog.

## Repo `codebase` chứa gì?

Mỗi thư mục cấp đầu là một site. Bên trong là những gì DevTools thấy ở tab **Sources** khi mở site đó: thư mục theo từng host mà trang tải script về (domain chính, CDN, và cả các bên thứ ba như `cdn.pendo.io`, `bat.bing.com`, `browser.sentry-cdn.com`), cùng các thư mục `webpack/`, `(webpack)/`, `src/` được trình duyệt dựng lại từ **source map**.

Source map là thứ quyết định repo này có đọc được hay không:

- Site nào phát hành source map công khai thì ta có lại gần như nguyên vẹn cây thư mục gốc: tên file, tên biến, comment, cả kiểu TypeScript. Telegram Web, App Store (Svelte), Trello, Elastic Cloud, Coursera thuộc nhóm này. Ví dụ `web.telegram.org/src/util/fastSmoothScroll.ts` đọc như code trong repo nội bộ của họ.
- Site không có source map thì chỉ còn bundle đã minify (vd `auth.udacity.com/.../static/js/main.12b11e7b.chunk.js`). Vẫn đọc được, nhưng chậm hơn nhiều; cách đọc loại này đã nói kỹ ở [bài mở đầu series Facebook](/blogs/learn-from-facebook-source-code).

Kích thước rất khác nhau. Đếm số file `.js/.ts/.tsx/.jsx/.svelte` trong từng thư mục (tính cả thư viện và script bên thứ ba):

| Nhóm | Site (số file) |
|---|---|
| Rất lớn | Outlook (≈7.800), SimilarWeb (≈4.400), Coursera (≈3.400), Udemy (≈2.800), HubSpot (≈2.600), Pipedrive (≈2.400), Trello (≈2.300) |
| Lớn | Elastic Cloud (≈1.700), Best Buy (≈1.400), Anchor (≈960), Simplified (≈750), Zappos (≈680), InVision (≈670), Tribe (≈660), Telegram (≈630), Calibre (≈600) |
| Vừa và nhỏ | Stackshare, Postman, Classroom Udacity, Skillshare, Apple App Store, Glitch, Intercom, Gatsby, Ello, Sendbird, Toptal, Auth Udacity (170–570) |

Con số này không nói lên độ phức tạp của sản phẩm. Phần lớn file của Outlook là thư viện và SDK; còn Telegram chỉ khoảng 630 file nhưng gần như toàn bộ là code tự viết, kể cả một framework riêng.

Thư mục `notes/` trong repo là ghi chú đã chắt lọc: mỗi site một file, cùng bộ `cookbook/` gom 81 kỹ thuật theo chủ đề, cộng hơn 100 mục bổ sung trong ghi chú từng site. Series này dùng ghi chú làm bản đồ, nhưng mọi bài đều **đọc lại code gốc** để xác minh. Ghi chú viết nhanh có chỗ sai, và vài chỗ như thế đã được sửa trong lúc viết series.

## 28 site, mỗi site một bài học

Bảng dưới tóm tắt stack và điểm đáng học nhất của từng site. Những dòng có số bài là kỹ thuật được viết thành bài trong series.

| Site | Stack (đọc từ code) | Điểm đáng học | Bài |
|---|---|---|---|
| Gatsby | Gatsby, theme-ui | Dark mode không nháy, lazy hydration ảnh | #1 |
| Toptal | React SSR trên framework nội bộ `@toptal/frontier` | 35+ hook: `useValueByMedia`, `useIdle`, `usePageLeave`; hàng đợi callback, gộp request trùng | #2, #3, #25, #35 |
| InVision | React, Redux-Saga | `useWiggle` (lắc chuột), giới hạn kích thước cookie, truyền dữ liệu giữa app qua URL | #3, #15, #64 |
| Udacity Auth | React, design system VDS | Độ mạnh mật khẩu theo ký tự duy nhất | #4 |
| Pipedrive | React, TypeScript, atomic design | `useRequiredFields`, cắt chữ bằng canvas, khoá phím khi kết quả chưa ổn định, kéo-thả lịch có bù DST | #4, #25, #34, #49, #52, #54 |
| Ello | React, Redux, redux-saga | Kiểm tra file bằng magic number, EXIF, dán ảnh, autocomplete tại con trỏ, breakpoint đọc từ CSS | #5, #21, #57 |
| Telegram Web | Framework tự viết `Teact` | Cuộn xa vẫn nhanh, Worker RPC, tab chủ, gesture, phát video qua Service Worker, tin nhắn thoại | #6, #12, #14, #21, #28, #30, #37, #39, #56, #58 |
| Best Buy | React, Redux, `business-rules/` | Countdown giả lập ngày cho QA, tombstone giỏ hàng, buffer analytics, phát hiện adblock | #7, #60, #61 |
| Apple App Store | Svelte | Hàng đợi rAF 3ms/frame, srcset cho artwork, preconnect, LineClamp, gradient từ artwork, khôi phục cuộn | #8, #9, #25, #44, #50, #55, #56, #57 |
| HubSpot | React, chia theo domain nghiệp vụ | Quick-fetch, bầu tab chủ cho thông báo, iframe nói chuyện với trang chứa | #10, #14, #64 |
| Postman | React, MobX, page manifest | Performance span bằng User Timing, three-way merge trên client | #11, #42 |
| Calibre | Rails + React, thư viện chart tự viết | Dòng thời gian long task, crosshair tooltip | #11 |
| Skillshare | Backbone.js | Đếm thời gian xem chống sleep | #13 |
| Simplified | React, Redux, fabric.js | Master timeline sửa lệch, đường gióng hút cạnh trên canvas | #13, #31 |
| Elastic Cloud | React, Redux, TypeScript | Đồng bộ đăng nhập giữa các tab, báo bản mới qua header `x-ui-tag` | #15, #16, #26 |
| Trello | Monorepo ~50 package nội bộ | Tự cập nhật ở ranh giới an toàn, phím tắt theo phạm vi, giả lập mù màu, polling thưa dần, clipboard | #16, #29, #32, #36, #54, #56 |
| Zappos | React, Redux | Reverse portal, SPA tự hết hạn, đo ảnh màn hình đầu | #16, #17, #55, #60 |
| Intercom | Next.js, Contentful | Page Behaviors cấu hình từ CMS | #18 |
| Outlook Web | Floodgate, roosterjs, GraphQL resolver | Bitmask tần suất, dark mode email bằng CIELAB, TTI governor, upload chia chunk, dọn cache GraphQL, focus stack | #19, #22, #23, #24, #26, #38, #39, #40, #43, #44, #46, #50, #53, #59, #60, #63 |
| Coursera | Naptime, React Aria | `HTTPHybridLink`: REST sang GraphQL dần dần, ngôn ngữ markup CML, transcript | #20, #48, #51, #59 |
| Glitch | React, XState, observable | `track-serially` (chỉ chạy lệnh mới nhất), `useObservable`, OT với CodeMirror | #35, #47 |
| Stackshare | React, Apollo | Analytics context lồng nhau, gom lô | |
| Classroom Udacity | React, Redux | Iframe chấm code, kiểm tra cookie bên thứ ba | |
| Tribe | Next.js, Apollo, Chakra UI | Optimistic reaction bằng `writeFragment`, đọc lỗi XML của S3, dán thông minh | #38, #54 |
| Anchor | React, React Query | Nền đổi màu theo cuộn, vạch thước theo mức zoom, tách audio bằng ffmpeg.wasm, copy trên iOS | #30, #33, #54 |
| Udemy | Design system `@udemy/*` | menuAim, ô tìm kiếm, RUM tự viết, cache localStorage có hạn, proof-of-work, DST không thư viện | #27, #34, #37, #41, #49, #51, #62 |
| SimilarWeb | React, Redux, Highcharts | Gộp nhiều AbortSignal, cache IndexedDB theo version, cấp phát màu cho chart, lọc tăng dần trong Worker, single-spa | #33, #34, #37, #44, #45, #64 |
| Sendbird | Bundle + Sentry SDK nguyên bản | UTM → cookie → CRM | |

Ba site chưa có bài riêng (Stackshare, Classroom Udacity, Sendbird) vẫn có trong ghi chú `notes/<site>.md`; phần lớn kỹ thuật hay của chúng đã được series Facebook hoặc các bài khác đề cập.

## Cách đọc code production

Quy trình dưới đây là cách các bài trong series được viết.

```mermaid
flowchart LR
  A["Thư mục site trong repo codebase"] --> B{"Có source map?"}
  B -- "có" --> C["Cây src/ gốc: tên file, comment, kiểu"]
  B -- "không" --> D["Bundle minify: lần theo chuỗi và API"]
  C --> E["Tách code nhà khỏi thư viện vendored"]
  D --> E
  E --> F["Đọc kỹ một kỹ thuật, ghi đường dẫn file"]
  F --> G["Viết lại từ đầu bằng React + TS"]
  G --> H["Demo trong examples/web-patterns"]
  H --> I["Bài viết: vấn đề, cách site làm, code, edge case"]
```

### 1. Tách code nhà khỏi thư viện

Bước dễ bị bỏ qua nhất, và cũng là nguồn sai nhiều nhất. Một hàm trông rất hay có thể là của thư viện chứ không phải của đội sản phẩm:

- `dashboard.sendbird.com` và `auth.udacity.com` chứa nguyên mã nguồn Sentry SDK (`SyncPromise`, Hub/Scope). Đó là thiết kế của Sentry.
- Coursera mang theo cả `@react-aria` của Adobe. Phần thực sự của Coursera là lớp mạng Naptime và `HTTPHybridLink`.
- Outlook có Fuse.js (thuật toán Bitap) và Floodgate SDK của Microsoft; Simplified có `web-vitals` và `react-design-editor`; Intercom có client của Next.js.

Dấu hiệu nhận biết: thư mục `node_modules` hay tên package trong đường dẫn, header bản quyền, comment kiểu `@license`, hoặc tên hàm trùng với tài liệu của một thư viện quen. Code vendored vẫn đáng đọc, nhưng khi viết bài phải ghi rõ "đây là thư viện X".

### 2. Lần theo chuỗi và API trình duyệt

Muốn tìm cách một site xử lý chuyện gì, grep theo thứ không bao giờ bị minify:

- Tên API trình duyệt: `BroadcastChannel`, `visibilitychange`, `requestIdleCallback`, `PerformanceObserver`, `sendBeacon`.
- Key lưu trữ và tên sự kiện: `localStorage.setItem('…')`, tên cookie, tên event analytics.
- Chuỗi hiển thị cho người dùng: thông báo lỗi, nhãn nút.

```bash
# Ai dùng BroadcastChannel?
grep -rl "BroadcastChannel" --include=*.{js,ts,tsx} . | grep -v node_modules

# Code tự cập nhật của Trello
grep -rn "shouldReloadToUpdate" trello.com --include=*.ts | head
```

### 3. Nhận diện framework

Tên file và cách viết tiết lộ framework trước cả khi đọc logic: `.svelte` và `$:` là Svelte (Apple); `Backbone.View.extend` và helper cho `stickit` là Backbone (Skillshare); `getGlobal` từ `lib/teact/teactn` là framework tự viết của Telegram; thư mục `pages/` đi cùng `next-server` hay `next/router` là Next.js (Intercom, Tribe). Biết framework thì biết đâu là quy ước của framework, đâu là lựa chọn riêng của đội.

### 4. Đọc thành tầng, ghi lại đường dẫn

Mỗi kỹ thuật trong series đi kèm đường dẫn file gốc, để bạn tự mở ra kiểm tra. Khi lý do của một quyết định không có trong code (không comment, không commit message), bài sẽ ghi rõ là "có lẽ" thay vì khẳng định.

## Series được tổ chức thế nào?

Mười ba phần, đọc theo thứ tự nhưng mỗi bài đều đứng riêng được:

1. **Trải nghiệm người dùng** (#1–#7): những chi tiết người dùng cảm thấy ngay. Trang không chớp trắng khi bật dark mode, form báo lỗi đúng lúc, cuộn qua 5.000 tin nhắn trong nửa giây, countdown khuyến mãi mà QA kiểm thử được.
2. **Hiệu năng và đo lường** (#8–#13): chia việc theo frame, bắn request trước khi JavaScript tải xong, đo span và long task, đẩy việc nặng sang Worker, đồng hồ media không bị lệch khi máy ngủ.
3. **Nhiều tab, phiên đăng nhập, cập nhật** (#14–#16): người dùng mở mười tab. Chỉ một tab nên kêu thông báo, đăng xuất ở một tab thì các tab khác phải biết, và bản deploy mới phải tới được cả những tab mở từ tuần trước.
4. **Kiến trúc** (#17–#20): di chuyển component không remount, cho đội marketing gắn hành vi từ CMS, giới hạn tần suất hiển thị, chuyển REST sang GraphQL mà không viết lại cả app.
5. **Soạn thảo và hiển thị nội dung** (#21–#26): autocomplete ngay tại con trỏ, dark mode cho email HTML bất kỳ, bảng quá rộng, cảnh báo quên đính kèm, cắt chữ nhiều dòng chính xác, parse ngày người dùng gõ.
6. **Tương tác** (#27–#33): menu không đóng khi rê chéo, kéo vuốt chung cho chuột và cảm ứng, phím tắt theo phạm vi, nội suy màu, canvas có đường gióng và undo, giả lập mù màu, vạch thước theo zoom.
7. **Mạng, dữ liệu và async** (#34–#39): ô tìm kiếm chuẩn production, chỉ chạy lệnh mới nhất, polling thưa dần, cache phía client theo version, upload file lớn theo chunk, phát video qua Service Worker.
8. **Hiệu năng và vận hành** (#40–#41): hoãn việc phụ tới khi trang dùng được, tự đo Web Vitals trên máy người dùng và phục vụ bản nhẹ cho máy yếu.
9. **Thuật toán và dữ liệu phía client** (#42–#48): three-way merge trong trình duyệt, dọn cache bằng đếm tham chiếu, LRU cache, lọc tăng dần trong Worker, xếp hạng gợi ý trên client, OT cho editor, ngôn ngữ markup riêng.
10. **Thời gian, ngôn ngữ, định dạng** (#49–#51): giờ mùa hè không cần thư viện, `Intl` trong thực tế, phụ đề WebVTT và bôi chọn transcript.
11. **Tương tác và giao diện** (#52–#57): kéo-thả trên lịch, focus cho popup lồng nhau, clipboard, khôi phục vị trí cuộn, lấy màu từ ảnh, JS đọc breakpoint từ CSS.
12. **Media** (#58–#59): ghi âm tin nhắn thoại kèm waveform, chụp frame video thành ảnh.
13. **Đo lường, bảo mật, vận hành** (#60–#64): đo ảnh màn hình đầu kể cả khi chuyển trang SPA, buffer analytics, proof-of-work, prefetch không làm sai số liệu, ghép micro-frontend.

Mỗi bài có cùng bố cục: vấn đề → site làm thế nào (kèm đường dẫn code gốc) → cơ chế trong trình duyệt → code viết lại → edge case → demo → cách dùng trong dự án → test mẫu. Danh sách đầy đủ ở cuối bài.

## Chạy code mẫu

Code của cả series nằm ở [`examples/web-patterns`](https://github.com/hunghg255/blog-hunghg/tree/master/examples/web-patterns): Vite + React 19 + TypeScript, không phụ thuộc thư viện ngoài React. Mỗi kỹ thuật là một file trong `src/lib/`, mỗi demo một file trong `src/demos/`.

```bash
git clone https://github.com/hunghg255/blog-hunghg
cd blog-hunghg/examples/web-patterns
npm ci
npm run dev        # mở http://localhost:5173, chọn demo trong danh sách
```

Hoặc mở thẳng [trên StackBlitz](https://stackblitz.com/github/hunghg255/blog-hunghg/tree/master/examples/web-patterns) để sửa code mà không cần cài gì. Demo nhúng trong bài là bản build tĩnh của chính thư mục này.

## Học ý tưởng, không chép code

Code trong repo `codebase` là tài sản của các công ty tương ứng. Nó được tải về trình duyệt của bất kỳ ai mở site, nhưng điều đó không có nghĩa là được phép dùng lại. Series theo ba nguyên tắc:

- **Chỉ trích ngắn** đoạn code gốc khi cần phân tích, kèm đường dẫn nguồn.
- **Viết lại từ đầu** mọi thứ trong `examples/web-patterns`, theo ý tưởng chứ không theo từng dòng. Nhiều bản viết lại khác bản gốc có chủ đích (sửa lỗi, bỏ phụ thuộc nội bộ), và bài nào cũng có mục "Khác bản gốc".
- **Không dùng** cho mục đích thương mại phần code gốc. Ý tưởng kỹ thuật (bầu tab chủ, quick-fetch, bitmask tần suất) thì là kiến thức chung, cứ mang về dự án của bạn.

Nếu bạn chưa đọc series Facebook, [bài mở đầu](/blogs/learn-from-facebook-source-code) có thêm mẹo đọc code đã minify và giải mã module kiểu `__d(...)`, rất hữu ích cho những site trong repo không có source map.

---

Bài này thuộc series **[Học từ mã nguồn các web lớn](/series/web)** (65 bài, đọc theo thứ tự).

::: spoiler Xem nhanh danh sách bài trong series

*Mở đầu*

- **Mở đầu: đọc code production của 28 trang web** (bài này)

*Phần 1: trải nghiệm người dùng*

- [#1 Dark mode không nháy (Gatsby)](/blogs/web-dark-mode-no-flash)
- [#2 useValueByMedia: giá trị theo breakpoint (Toptal)](/blogs/web-use-value-by-media)
- [#3 Đoán ý định: idle, exit-intent, lắc chuột (Toptal, InVision)](/blogs/web-user-intent-idle-exit-wiggle)
- [#4 Validate form thân thiện (Udacity, Pipedrive)](/blogs/web-form-validation-ux)
- [#5 Magic number, EXIF và dán ảnh (Ello)](/blogs/web-file-magic-number-exif-paste)
- [#6 fastSmoothScroll: cuộn xa vẫn nhanh (Telegram)](/blogs/web-telegram-fast-smooth-scroll)
- [#7 Countdown time-travel và tombstone giỏ hàng (Best Buy)](/blogs/web-countdown-time-travel-tombstone)

*Phần 2: hiệu năng và đo lường*

- [#8 Hàng đợi requestAnimationFrame 3ms (Apple)](/blogs/web-raf-queue-3ms)
- [#9 srcset cho artwork và preconnect tự động (Apple)](/blogs/web-responsive-artwork-preconnect)
- [#10 Quick-fetch: gọi API trước khi bundle tải xong (HubSpot)](/blogs/web-quick-fetch-early-requests)
- [#11 Performance span và long task (Postman, Calibre)](/blogs/web-performance-spans-long-tasks)
- [#12 Gọi Web Worker như hàm async (Telegram)](/blogs/web-worker-promise-rpc)
- [#13 Đồng hồ media: đếm giờ xem và sửa lệch (Skillshare, Simplified)](/blogs/web-media-clock-watch-time-drift)

*Phần 3: nhiều tab, phiên đăng nhập, cập nhật*

- [#14 Bầu tab chủ cho thông báo (HubSpot, Telegram)](/blogs/web-leader-tab-notifications)
- [#15 Đồng bộ đăng nhập giữa tab và giới hạn cookie (Elastic, InVision)](/blogs/web-cross-tab-auth-cookie-guard)
- [#16 SPA tự cập nhật: Trello, Zappos, Facebook, Elastic](/blogs/web-spa-self-update-strategies)

*Phần 4: kiến trúc*

- [#17 Reverse portal: di chuyển component không remount (Zappos)](/blogs/web-reverse-portal)
- [#18 Page behaviors: gắn hành vi từ CMS (Intercom)](/blogs/web-page-behaviors-cms)
- [#19 Giới hạn tần suất hiển thị bằng bitmask (Outlook)](/blogs/web-frequency-cap-bitmask)
- [#20 Chuyển REST sang GraphQL dần dần (Coursera)](/blogs/web-rest-to-graphql-hybrid-link)

*Phần 5: soạn thảo và hiển thị nội dung*

- [#21 Autocomplete tại con trỏ trong contenteditable (Ello, Telegram)](/blogs/web-caret-autocomplete-contenteditable)
- [#22 Dark mode cho email HTML bằng CIELAB (Outlook)](/blogs/web-email-dark-mode-cielab)
- [#23 Thu nhỏ bảng rộng cho vừa khung, vá font emoji (Outlook)](/blogs/web-email-wide-content-scale)
- [#24 Cảnh báo quên đính kèm file (Outlook)](/blogs/web-forgotten-attachment-warning)
- [#25 Cắt chữ nhiều dòng chính xác (Pipedrive, Apple, Toptal)](/blogs/web-multiline-truncate-measure-text)
- [#26 Parse ngày giờ gõ tay khoan dung (Outlook, Elastic)](/blogs/web-lenient-date-parser)

*Phần 6: tương tác*

- [#27 menuAim: rê chéo vào submenu không bị đóng (Udemy)](/blogs/web-menu-aim-triangle)
- [#28 Kéo, vuốt chung cho chuột và cảm ứng (Telegram)](/blogs/web-unified-pointer-gestures)
- [#29 Phím tắt theo phạm vi, IME và bàn phím phi Latinh (Trello)](/blogs/web-scoped-keyboard-shortcuts)
- [#30 Nội suy màu: đổi theme và nền theo cuộn (Telegram, Anchor)](/blogs/web-color-interpolation-theme-scroll)
- [#31 Đường gióng hút cạnh và undo/redo trên canvas (Simplified)](/blogs/web-canvas-snap-guides-undo)
- [#32 Giả lập mù màu bằng feColorMatrix (Trello)](/blogs/web-color-vision-simulator)
- [#33 Vạch thước theo mức zoom và cấp phát màu cho biểu đồ (Anchor, Similarweb)](/blogs/web-timeline-ticks-color-stack)

*Phần 7: mạng, dữ liệu và async*

- [#34 Ô tìm kiếm chuẩn production (Similarweb, Udemy, Pipedrive)](/blogs/web-production-search-box)
- [#35 Điều phối async: latest-wins, single-flight (Glitch, Toptal)](/blogs/web-async-coordination-latest-wins)
- [#36 Polling thưa dần và debounce động (Trello)](/blogs/web-decaying-polling-dynamic-debounce)
- [#37 Cache phía client theo version (Similarweb, Telegram, Udemy)](/blogs/web-client-cache-versioned)
- [#38 Upload file lớn theo chunk (Outlook, Tribe)](/blogs/web-chunked-upload-pipeline)
- [#39 Phát video qua Service Worker bằng Range request (Telegram, Outlook)](/blogs/web-service-worker-range-streaming)

*Phần 8: hiệu năng và vận hành*

- [#40 TTI governor: hoãn việc phụ tới sau khi trang dùng được (Outlook)](/blogs/web-tti-governor)
- [#41 Tự đo LCP/CLS/TBT và phục vụ bản nhẹ cho máy yếu (Udemy)](/blogs/web-rum-adaptive-loading)

*Phần 9: thuật toán và dữ liệu phía client*

- [#42 Three-way merge ngay trên trình duyệt (Postman)](/blogs/web-three-way-merge-client)
- [#43 Dọn cache GraphQL bằng đếm tham chiếu (Outlook)](/blogs/web-graphql-cache-refcount-gc)
- [#44 LRU cache theo 3 cách (Apple, Similarweb, Outlook)](/blogs/web-lru-cache-three-ways)
- [#45 Lọc tăng dần trong Web Worker (Similarweb)](/blogs/web-incremental-filter-worker)
- [#46 Xếp hạng gợi ý trên client, so ngầm với server (Outlook)](/blogs/web-client-side-ranking-shadow-test)
- [#47 Nối OT với editor: undo stack và chặn echo (Glitch)](/blogs/web-ot-codemirror-undo)
- [#48 Ngôn ngữ markup riêng dịch hai chiều với HTML (Coursera)](/blogs/web-custom-markup-compiler)

*Phần 10: thời gian, ngôn ngữ, định dạng*

- [#49 Xử lý giờ mùa hè không cần thư viện (Udemy, Pipedrive)](/blogs/web-dst-without-library)
- [#50 Intl thực chiến: Segmenter, số rút gọn, số nhiều, fallback locale (Apple, Outlook)](/blogs/web-intl-in-production)
- [#51 WebVTT và bôi chọn transcript (Udemy, Coursera)](/blogs/web-webvtt-transcript-selection)

*Phần 11: tương tác và giao diện*

- [#52 Kéo-thả trên lịch (Pipedrive)](/blogs/web-calendar-drag-drop)
- [#53 Focus stack cho popup lồng nhau (Outlook)](/blogs/web-focus-stack-nested-popups)
- [#54 Clipboard: copy, dán chữ thuần, dán thông minh (Trello, Anchor, Pipedrive, Tribe)](/blogs/web-clipboard-tricks)
- [#55 Khôi phục vị trí cuộn khi trang còn đang tải (Apple, Zappos)](/blogs/web-scroll-restore-wait-height)
- [#56 Lấy màu từ ảnh: gradient nền, màu chữ (Apple, Telegram, Trello)](/blogs/web-colors-from-images)
- [#57 JS đọc breakpoint từ CSS, phát hiện chế độ PWA (Ello, Apple)](/blogs/web-css-js-breakpoint-bridge)

*Phần 12: media*

- [#58 Tin nhắn thoại: ghi âm, waveform realtime, nén 5-bit (Telegram)](/blogs/web-voice-message-waveform)
- [#59 Chụp frame video thành ảnh, canvas bị taint (Coursera, Outlook)](/blogs/web-video-frame-snapshot)

*Phần 13: đo lường, bảo mật, vận hành*

- [#60 Đo lúc ảnh màn hình đầu tải xong, cả khi chuyển trang SPA (Zappos, Best Buy, Outlook)](/blogs/web-above-the-fold-image-timing)
- [#61 Buffer analytics chờ SDK, phát hiện adblock (Best Buy)](/blogs/web-analytics-buffer-adblock)
- [#62 Proof-of-work trên client để chặn API ẩn danh (Udemy)](/blogs/web-client-proof-of-work)
- [#63 Prefetch không làm lệch số liệu, nén cài đặt bằng bit (Outlook)](/blogs/web-synthetic-prefetch-bit-flags)
- [#64 Micro-frontend: AngularJS và React chung app, giao tiếp xuyên frame (Similarweb, InVision, HubSpot)](/blogs/web-micro-frontend-bridges)

:::

Code + demo: [`examples/web-patterns`](https://github.com/hunghg255/blog-hunghg/tree/master/examples/web-patterns) · [Mở trên StackBlitz](https://stackblitz.com/github/hunghg255/blog-hunghg/tree/master/examples/web-patterns)
