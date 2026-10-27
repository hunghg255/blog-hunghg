import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'weekly-hours',
  title: 'Giờ mở cửa theo tuần',
  desc: 'Khoảng qua đêm, gộp khoảng chồng, phần bù, trạng thái theo múi giờ cửa hàng',
  order: 47,
  load: () => import('../WeeklyHoursDemo'),
} satisfies DemoRegistration;
