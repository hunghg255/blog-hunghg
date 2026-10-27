import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'hybrid-link',
  title: 'REST sang GraphQL dần dần (Coursera)',
  desc: 'Một link mạng chọn đường cho từng query: @naptime đi REST cũ, còn lại gom batch lên gateway GraphQL.',
  order: 20,
  load: () => import('../HybridLinkDemo'),
} satisfies DemoRegistration;
