import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'dom-batch',
  title: 'Đọc trước, ghi sau trong một frame',
  desc: 'Layout thrashing, chống trùng theo key, con tự biết vị trí',
  order: 56,
  load: () => import('../DomBatchDemo'),
} satisfies DemoRegistration;
