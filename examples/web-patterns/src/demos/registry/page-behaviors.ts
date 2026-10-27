import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'page-behaviors',
  title: 'Page behaviors từ CMS (Intercom)',
  desc: 'CMS chọn và cấu hình hành vi cho từng trang (banner, CSS riêng, exit-intent), code chỉ giữ registry.',
  order: 18,
  load: () => import('../PageBehaviorsDemo'),
} satisfies DemoRegistration;
