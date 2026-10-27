import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'document-scroll-modal',
  title: 'Modal cuộn bằng window',
  desc: 'Scroll view stack: modal dùng thanh cuộn thật, đóng lại feed về đúng chỗ',
  order: 11,
  load: () => import('../ScrollModalDemo'),
} satisfies DemoRegistration;
