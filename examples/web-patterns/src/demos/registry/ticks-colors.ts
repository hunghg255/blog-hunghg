import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'ticks-colors',
  title: 'Vạch thước theo zoom và cấp phát màu',
  desc: 'Chọn bước vạch/nhãn cho timeline theo px mỗi giây, và cấp màu không trùng cho series biểu đồ (Anchor, Similarweb)',
  order: 33,
  load: () => import('../TicksColorsDemo'),
} satisfies DemoRegistration;
