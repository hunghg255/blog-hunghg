import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'network-prefetch',
  title: 'Tải trước theo chất lượng mạng',
  desc: 'Buffer tải trước đuôi feed lớn dần khi mạng kém, đo số lần va vào skeleton',
  order: 30,
  load: () => import('../NetworkPrefetchDemo'),
} satisfies DemoRegistration;
