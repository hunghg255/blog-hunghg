import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'perf-spans',
  title: 'Performance span và long task (Postman, Calibre)',
  desc: 'Đo span bằng User Timing, gửi theo nhịp có giới hạn, vẽ long task kiểu Calibre và chặn race khi chuyển trang.',
  order: 11,
  load: () => import('../PerfSpansDemo'),
} satisfies DemoRegistration;
