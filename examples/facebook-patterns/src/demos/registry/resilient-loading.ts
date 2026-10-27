import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'resilient-loading',
  title: 'Tải JS/CSS bền bỉ',
  desc: 'Preload, retry có ngắt mạch, phát hiện CSS đã áp dụng',
  order: 20.1,
  load: () => import('../ResilientLoadingDemo'),
} satisfies DemoRegistration;
