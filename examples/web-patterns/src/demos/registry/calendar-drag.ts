import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'calendar-drag',
  title: 'Kéo-thả trên lịch',
  desc: 'Ngưỡng click/kéo, nuốt click sau khi kéo, tự cuộn ở mép, hút 15 phút, không lệch giờ ngày đổi giờ (Pipedrive)',
  order: 52,
  load: () => import('../CalendarDragDemo'),
} satisfies DemoRegistration;
