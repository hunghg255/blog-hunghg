import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'ud-progress',
  title: 'Udemy #3: tiến độ xem theo bucket',
  desc: 'Chỉ báo khi sang bucket 15 giây, gom 5 bản ghi, tự hoàn thành 15 giây cuối, thử lại 500·n² ms; bản viết lại đếm giây xem thật và không mất batch',
  order: 203,
  load: () => import('../UdProgressDemo'),
} satisfies DemoRegistration;
