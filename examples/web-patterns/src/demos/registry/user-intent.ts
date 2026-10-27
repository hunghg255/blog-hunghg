import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'user-intent',
  title: 'Đoán ý định người dùng',
  desc: 'Idle, exit-intent và lắc chuột',
  order: 3,
  load: () => import('../UserIntentDemo'),
} satisfies DemoRegistration;
