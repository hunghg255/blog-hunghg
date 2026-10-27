import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'keyframes-loop',
  title: 'Engine animation bằng JS',
  desc: 'Một vòng rAF chung, kẹp delta, solver cubic-bezier',
  order: 27,
  load: () => import('../KeyframesDemo'),
} satisfies DemoRegistration;
