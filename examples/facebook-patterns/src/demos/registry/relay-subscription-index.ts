import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'relay-subscription-index',
  title: 'Chỉ mục subscription, hàng đợi theo chiều sâu, cache LRU',
  desc: 'Chỉ đọc lại component dính record vừa đổi, subscription ma sau dispose, task con chen đầu hàng, LRU thật thay FIFO',
  order: 89,
  load: () => import('../SubscriptionIndexDemo'),
} satisfies DemoRegistration;
