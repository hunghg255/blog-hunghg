import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'try-scroll',
  title: 'Khôi phục vị trí cuộn và skip link',
  desc: 'Back về trang đang tải dần: chờ trang đủ cao rồi mới cuộn; skip link kiểm tra document.activeElement (Apple, Zappos)',
  order: 55,
  load: () => import('../TryScrollDemo'),
} satisfies DemoRegistration;
