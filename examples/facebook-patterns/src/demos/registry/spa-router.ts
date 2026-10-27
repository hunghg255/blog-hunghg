import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'spa-router',
  title: 'Router SPA "sạch sẽ"',
  desc: 'Tự reload sau N lần điều hướng, back an toàn, chặn rời trang',
  order: 20,
  load: () => import('../SpaRouterDemo'),
} satisfies DemoRegistration;
