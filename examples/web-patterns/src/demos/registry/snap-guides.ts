import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'snap-guides',
  title: 'Đường gióng hút cạnh và undo/redo',
  desc: 'Kéo khối trên artboard: hút vào cạnh/tâm khối khác trong 4px, đường gióng cam, lịch sử snapshot (Simplified)',
  order: 31,
  load: () => import('../SnapGuidesDemo'),
} satisfies DemoRegistration;
