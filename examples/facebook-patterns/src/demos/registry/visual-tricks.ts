import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'visual-tricks',
  title: 'Mẹo hình ảnh',
  desc: 'Avatar khoét SVG mask, gradient Messenger, skeleton steps()',
  order: 15,
  load: () => import('../VisualTricksDemo'),
} satisfies DemoRegistration;
