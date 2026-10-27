import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'api-batcher',
  title: 'Gộp lời gọi API trong một tick',
  desc: '12 thẻ, 12 lời gọi, 1 request HTTP; đủ 50 thì tách chuyến',
  order: 32,
  load: () => import('../ApiBatcherDemo'),
} satisfies DemoRegistration;
