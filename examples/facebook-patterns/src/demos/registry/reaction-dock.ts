import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'reaction-dock',
  title: 'Bảng reaction nhấn giữ rồi trượt',
  desc: 'elementFromPoint khi trượt, chặn click 200ms, lật dock dưới header, roving tabindex',
  order: 24,
  load: () => import('../ReactionDockDemo'),
} satisfies DemoRegistration;
