import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'send-queue',
  title: 'Hàng đợi gửi tin giữ thứ tự',
  desc: 'Một tin bay một lúc, tạm dừng sync khi gửi, tin lỗi kéo theo các tin sau',
  order: 31,
  load: () => import('../SendQueueDemo'),
} satisfies DemoRegistration;
