import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'query-serializer',
  title: 'Query kiểu PHP chống prototype pollution',
  desc: 'Ba parser đọc cùng một query: viết lại, kiểu Facebook, ngây thơ',
  order: 74,
  load: () => import('../QuerySerializerDemo'),
} satisfies DemoRegistration;
