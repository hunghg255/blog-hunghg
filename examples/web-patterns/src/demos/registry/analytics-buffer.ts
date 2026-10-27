import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'analytics-buffer',
  title: 'Buffer analytics chờ SDK, phát hiện adblock',
  desc: 'Hàng đợi vòng không bỏ page view, báo số sự kiện bị mất; phần tử mồi để biết có trình chặn quảng cáo (Best Buy)',
  order: 61,
  load: () => import('../AnalyticsBufferDemo'),
} satisfies DemoRegistration;
