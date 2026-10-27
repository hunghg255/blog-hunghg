# web-patterns

Code ví dụ cho series **"Học từ mã nguồn các web lớn"** trên [blog.hunghg.me](https://blog.hunghg.me/series/web).

Mỗi kỹ thuật được **viết lại từ đầu** bằng TypeScript + React 19 dựa trên ý tưởng đọc được trong source frontend của các web app lớn (Gatsby, Toptal, Telegram, Apple, HubSpot, Trello, Zappos…), tổng hợp trong repo [hunghg255/codebase](https://github.com/hunghg255/codebase). Đây không phải mã nguồn gốc của các công ty đó. Code nằm trong `src/lib`.

Thêm demo mới: tạo `src/demos/XxxDemo.tsx` và một file `src/demos/registry/<route>.ts` (xem `src/demoRegistry.ts`), `main.tsx` tự nhận.

## Chạy local

```bash
npm install
npm run dev
```

Hoặc mở trên StackBlitz:
<https://stackblitz.com/github/hunghg255/blog-hunghg/tree/master/examples/web-patterns>

## Build cho blog

Blog nhúng bản build tĩnh tại `public/demos/web-patterns` bằng iframe. Sau khi sửa code, build lại:

```bash
npm run build:blog   # hoặc ở thư mục gốc của blog: pnpm build:demos
```
