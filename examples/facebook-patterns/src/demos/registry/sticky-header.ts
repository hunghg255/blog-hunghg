import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'sticky-header',
  title: 'Sticky header bằng sentinel',
  desc: 'Biết khi nào header "dính" mà không nghe scroll, đổi class trong rAF',
  order: 14.1,
  load: () => import('../StickyHeaderDemo'),
} satisfies DemoRegistration;
