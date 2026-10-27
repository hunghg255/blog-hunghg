import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'dst',
  title: 'Giờ mùa hè không cần thư viện',
  desc: 'Ô lịch ngày đổi giờ, giờ không tồn tại / có hai lần, đếm ngày coupon (Udemy, Pipedrive)',
  order: 49,
  load: () => import('../DstDemo'),
} satisfies DemoRegistration;
