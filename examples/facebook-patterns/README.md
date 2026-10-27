# facebook-patterns

Code ví dụ cho loạt bài **"Học từ mã nguồn Facebook"** trên [blog.hunghg.me](https://blog.hunghg.me/blogs/learn-from-facebook-source-code).

Gồm 20 kỹ thuật (phần 1: #1–#8, phần 2: #9–#20). Mỗi kỹ thuật được **viết lại từ đầu** bằng TypeScript + React 19 dựa trên ý tưởng đọc được trong bundle frontend của Facebook. Đây không phải mã nguồn gốc của Meta. Code nằm trong `src/lib`, phần lớn mỗi file độc lập nên có thể copy riêng vào dự án.

Thêm demo mới: tạo `src/demos/XxxDemo.tsx` và một file `src/demos/registry/<route>.ts` (xem `src/demoRegistry.ts`), `main.tsx` tự nhận.

| Kỹ thuật | Code | Demo |
| --- | --- | --- |
| Shared IntersectionObserver | [`observeIntersection.ts`](src/lib/observeIntersection.ts), [`useInView.ts`](src/lib/useInView.ts) | `#/shared-intersection-observer`, `#/infinite-scroll` |
| Đo thời gian hiển thị | [`useViewportDuration.ts`](src/lib/useViewportDuration.ts), [`userActivity.ts`](src/lib/userActivity.ts) | `#/viewport-duration` |
| Preload khi hover | [`preload.ts`](src/lib/preload.ts) | `#/preload-on-hover` |
| Toast manager | [`toaster.ts`](src/lib/toaster.ts) | `#/toaster` |
| Network status + heartbeat | [`networkStatus.ts`](src/lib/networkStatus.ts) | `#/network-status` |
| ErrorGuard | [`errorGuard.ts`](src/lib/errorGuard.ts) | `#/error-guard` |
| Batch logger | [`batchLogger.ts`](src/lib/batchLogger.ts) | `#/batch-logger` |
| Focus trap + Esc theo layer | [`focusTrap.ts`](src/lib/focusTrap.ts) | `#/focus-trap` |
| Mẹo `calc(… * 9999)` | [`cssOverflowTricks.ts`](src/lib/cssOverflowTricks.ts) | `#/css-9999` |
| Thanh cuộn CSS 3D | [`perspectiveScrollbar.ts`](src/lib/perspectiveScrollbar.ts) | `#/custom-scrollbar` |
| Modal cuộn bằng window | [`documentScrollView.tsx`](src/lib/documentScrollView.tsx) | `#/document-scroll-modal` |
| Popover, tooltip group, hovercard | [`contextualLayer.ts`](src/lib/contextualLayer.ts) | `#/popover` |
| Pressable + focus-visible | [`pressable.ts`](src/lib/pressable.ts) | `#/pressable` |
| Tab "Xem thêm" + sticky header | [`priorityTabs.tsx`](src/lib/priorityTabs.tsx) | `#/priority-tabs`, `#/sticky-header` |
| Avatar mask, gradient chat, glimmer | [`maskedAvatar.tsx`](src/lib/maskedAvatar.tsx) | `#/visual-tricks` |
| Khung chat không giật | [`useChatScroller.ts`](src/lib/useChatScroller.ts) | `#/chat-scroller` |
| Bố cục collage ảnh | [`collageLayout.ts`](src/lib/collageLayout.ts) | `#/photo-collage` |
| Keep-alive tab | [`keepAlive.tsx`](src/lib/keepAlive.tsx) | `#/keep-alive` |
| Visual Completion & interaction tracing | [`visualCompletion.ts`](src/lib/visualCompletion.ts) | `#/visual-completion` |
| Router SPA + tải chunk bền bỉ | [`routerHygiene.ts`](src/lib/routerHygiene.ts) | `#/spa-router`, `#/resilient-loading` |

## Chạy local

```bash
npm install
npm run dev
```

Hoặc mở trên StackBlitz:
<https://stackblitz.com/github/hunghg255/blog-hunghg/tree/master/examples/facebook-patterns>

## Build cho blog

Blog nhúng bản build tĩnh tại `public/demos/facebook-patterns` bằng iframe. Sau khi sửa code, build lại:

```bash
npm run build:blog   # hoặc ở thư mục gốc của blog: pnpm build:demos
```
