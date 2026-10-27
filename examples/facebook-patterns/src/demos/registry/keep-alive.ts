import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'keep-alive',
  title: 'Keep-alive tab',
  desc: 'Giữ tab cũ còn sống có TTL, tự dừng khi bị ẩn',
  order: 18,
  load: () => import('../KeepAliveDemo'),
} satisfies DemoRegistration;
