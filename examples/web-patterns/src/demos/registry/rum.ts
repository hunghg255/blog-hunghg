import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'rum',
  title: 'RUM tự viết + bản nhẹ cho máy yếu',
  desc: 'Đo FCP, LCP, CLS, TBT, INP bằng PerformanceObserver; chọn bản nhẹ theo CPU, RAM, mạng (Udemy)',
  order: 41,
  load: () => import('../RumDemo'),
} satisfies DemoRegistration;
