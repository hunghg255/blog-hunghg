import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'leader-tab',
  title: 'Tab chủ cho thông báo',
  desc: 'Web Locks bầu một tab phát âm thanh, mở khoá autoplay sớm, favicon chấm đỏ (HubSpot, Telegram)',
  order: 14,
  load: () => import('../LeaderTabDemo'),
} satisfies DemoRegistration;
