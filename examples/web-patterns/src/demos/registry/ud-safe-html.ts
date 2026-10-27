import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'ud-safe-html',
  title: 'Udemy: parse HTML an toàn, kiểm tra href',
  desc: 'Document tách rời không chạy onerror, so sánh 4 cách parse, kiểm tra href bằng URL thay vì cắt chuỗi (Udemy)',
  order: 212,
  load: () => import('../UdSafeHtmlDemo'),
} satisfies DemoRegistration;
