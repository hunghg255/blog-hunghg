import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'proof-of-work',
  title: 'Proof-of-work trên client',
  desc: 'Bắt trình duyệt tìm nonce cho HMAC-SHA256 có N bit đầu bằng 0 trước khi gọi API; main thread so với Worker, gửi lại lời giải có / không có challenge (Udemy)',
  order: 62,
  load: () => import('../ProofOfWorkDemo'),
} satisfies DemoRegistration;
