import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'chat-scroller',
  title: 'Khung chat không giật',
  desc: 'Dính đáy, giữ vị trí khi tải tin cũ, chặn scroll chaining',
  order: 16,
  load: () => import('../ChatScrollerDemo'),
} satisfies DemoRegistration;
