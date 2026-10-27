import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'search-tokenize',
  title: 'Tìm kiếm gấp dấu',
  desc: 'Gõ "nguyen" ra "Nguyễn", highlight đúng đầu từ',
  order: 25,
  load: () => import('../SearchTokenizeDemo'),
} satisfies DemoRegistration;
