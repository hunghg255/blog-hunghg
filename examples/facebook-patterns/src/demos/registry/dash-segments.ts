import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'dash-segments',
  title: 'Segment DASH dự đoán và hộp sidx',
  desc: 'Xin segment live trước khi manifest kịp liệt kê, đọc byte-range từ hộp sidx',
  order: 60,
  load: () => import('../DashSegmentsDemo'),
} satisfies DemoRegistration;
