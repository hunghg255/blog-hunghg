import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'tg-read-receipts',
  title: 'Telegram: đã đọc bằng IntersectionObserver, thông báo không trùng',
  desc: 'Đánh dấu đã đọc theo marker đáy tin, đóng băng khi ẩn tab; chống hiện 2 thông báo giữa tab và service worker (Telegram)',
  order: 114,
  load: () => import('../TgReadReceiptsDemo'),
} satisfies DemoRegistration;
