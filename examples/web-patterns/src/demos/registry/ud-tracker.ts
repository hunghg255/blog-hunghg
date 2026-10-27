import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'ud-tracker',
  title: 'Udemy: pipeline tracking',
  desc: 'Gom lô 3 giây, sendBeacon khi ẩn tab, bfcache, HTTP 207 từng phần (Udemy)',
  order: 215,
  load: () => import('../UdTrackerDemo'),
} satisfies DemoRegistration;
