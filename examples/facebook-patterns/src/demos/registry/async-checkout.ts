import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'async-checkout',
  title: 'Thanh toán bất đồng bộ',
  desc: 'Charge, subscription, polling, timeout: kết quả đến trước thì thắng',
  order: 44,
  load: () => import('../AsyncCheckoutDemo'),
} satisfies DemoRegistration;
