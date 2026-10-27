import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'css-9999',
  title: 'Mẹo calc(… * 9999)',
  desc: 'Container query, line-clamp, mũi tên carousel bằng CSS thuần',
  order: 9,
  load: () => import('../CssTricksDemo'),
} satisfies DemoRegistration;
