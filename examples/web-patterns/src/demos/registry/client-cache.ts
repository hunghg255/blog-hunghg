import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'client-cache',
  title: 'Cache phía client theo version (Similarweb, Telegram, Udemy)',
  desc: 'IndexedDB tự làm mới theo version, stale-while-revalidate, Cache Storage làm kho key-value, localStorage có TTL an toàn nhiều tab.',
  order: 37,
  load: () => import('../ClientCacheDemo'),
} satisfies DemoRegistration;
