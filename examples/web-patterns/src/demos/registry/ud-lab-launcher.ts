import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'ud-lab-launcher',
  title: 'Udemy: mở lab không bị chặn popup',
  desc: 'Mở tab chờ ngay trong click rồi mới gọi API, xử lý 409, nhịp tim ghi tiến độ không chồng lượt (Udemy)',
  order: 210,
  load: () => import('../UdLabLauncherDemo'),
} satisfies DemoRegistration;
