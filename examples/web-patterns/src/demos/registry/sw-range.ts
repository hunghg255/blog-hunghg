import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'sw-range',
  title: 'Phát media qua Service Worker bằng Range (Telegram, Outlook)',
  desc: 'SW chặn request Range của thẻ audio, hỏi trang từng phần 512KB qua MessagePort, trả 206, cache 2MB đầu; JS redirect giữ #hash.',
  order: 39,
  load: () => import('../SwRangeDemo'),
} satisfies DemoRegistration;
