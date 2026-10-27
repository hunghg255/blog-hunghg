import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'range-calendar',
  title: 'Lịch chọn khoảng ngày',
  desc: 'Dải chọn bo góc theo hàng, đi phím đủ bộ, RTL, số tuần ISO',
  order: 46,
  load: () => import('../RangeCalendarDemo'),
} satisfies DemoRegistration;
