import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'drag-drop',
  title: 'Kéo-thả không nhấp nháy',
  desc: 'Đổi chỗ theo mép, overlay thả file đếm enter/leave',
  order: 35,
  load: () => import('../DragDropDemo'),
} satisfies DemoRegistration;
