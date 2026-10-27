import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'small-infra',
  title: 'Hạ tầng nhỏ: cookie, hash lỗi, chuột dừng',
  desc: 'CookieCore, getSimpleHash, CometMouseActivity',
  order: 37,
  load: () => import('../SmallInfraDemo'),
} satisfies DemoRegistration;
