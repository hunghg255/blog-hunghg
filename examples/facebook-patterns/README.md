# facebook-patterns

Code ví dụ cho loạt bài **"Học từ mã nguồn Facebook"** trên [blog.hunghg.me](https://blog.hunghg.me/blogs/learn-from-facebook-source-code).

Mỗi kỹ thuật được **viết lại từ đầu** bằng TypeScript + React 19 dựa trên ý tưởng đọc được trong bundle frontend của Facebook. Đây không phải mã nguồn gốc của Meta. Code nằm trong `src/lib`, mỗi file độc lập nên có thể copy riêng vào dự án.

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
