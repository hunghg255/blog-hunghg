import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'tg-optimistic-send',
  title: 'Telegram #1: gửi tin lạc quan',
  desc: 'Tin hiện ngay với id tạm, randomId làm khoá idempotency, icon đang gửi chỉ hiện sau 1s, upload song song nhưng gửi đúng thứ tự',
  order: 101,
  load: () => import('../TgOptimisticSendDemo'),
} satisfies DemoRegistration;
