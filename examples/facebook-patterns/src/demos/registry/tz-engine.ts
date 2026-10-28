import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'tz-engine',
  title: 'Engine múi giờ trên client',
  desc: 'Luật "Fri<=1" của Israel bị tính lệch một tháng, engine tự viết khớp Intl, bù đồng hồ máy bị chỉnh tay',
  order: 71,
  load: () => import('../TzEngineDemo'),
} satisfies DemoRegistration;
