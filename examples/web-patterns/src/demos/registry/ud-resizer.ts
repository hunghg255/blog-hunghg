import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'ud-resizer',
  title: 'Udemy: kéo mép để resize, mép cuộn mờ dần',
  desc: 'Resizer bằng Pointer Events tính theo điểm bắt đầu, mép cuộn mờ bằng mask-image (Udemy)',
  order: 217,
  load: () => import('../UdResizerDemo'),
} satisfies DemoRegistration;
