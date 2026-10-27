import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'value-by-media',
  title: 'useValueByMedia',
  desc: 'Giá trị JS theo breakpoint, mobile-first như CSS',
  order: 2,
  load: () => import('../ValueByMediaDemo'),
} satisfies DemoRegistration;
