import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'nice-ticks',
  title: 'Vạch trục số và thời gian "đẹp"',
  desc: 'Bước {1, 2, 5} × 10^k, bảng bước thời gian, căn vạch theo lịch',
  order: 64,
  load: () => import('../NiceTicksDemo'),
} satisfies DemoRegistration;
