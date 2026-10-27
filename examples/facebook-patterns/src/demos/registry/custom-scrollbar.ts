import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'custom-scrollbar',
  title: 'Thanh cuộn CSS 3D',
  desc: 'Thumb chạy trên compositor nhờ perspective + matrix3d',
  order: 10,
  load: () => import('../ScrollbarDemo'),
} satisfies DemoRegistration;
