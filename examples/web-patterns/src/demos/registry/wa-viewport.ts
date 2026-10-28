import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'wa-viewport',
  title: 'WhatsApp #9: theo dõi viewport tin nhắn, ngày dính',
  desc: 'Binary search tin đang thấy và date marker, sticky date tự ẩn sau 3 giây, giữ chỗ đọc khi mở drawer, pause GIF ngoài màn hình.',
  order: 309,
  load: () => import('../WaViewportDemo'),
} satisfies DemoRegistration;
