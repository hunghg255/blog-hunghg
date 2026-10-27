import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'lenient-date',
  title: 'Parse ngày giờ khoan dung',
  desc: 'Dựng regex từ định dạng ngày của locale, nhận nhiều cách gõ; đọc khoảng thời gian "1h30m" (Outlook, Elastic)',
  order: 26,
  load: () => import('../LenientDateDemo'),
} satisfies DemoRegistration;
