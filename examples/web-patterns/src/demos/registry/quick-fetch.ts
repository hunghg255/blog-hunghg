import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'quick-fetch',
  title: 'Quick-fetch: gọi API trước khi bundle tải xong (HubSpot)',
  desc: 'So sánh thác nước "tải JS rồi mới gọi API" với request sớm chạy song song, kèm trường hợp lỗi và không khớp URL.',
  order: 10,
  load: () => import('../QuickFetchDemo'),
} satisfies DemoRegistration;
