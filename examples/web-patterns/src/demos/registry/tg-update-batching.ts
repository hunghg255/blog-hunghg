import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'tg-update-batching',
  title: 'Telegram #4: gom update realtime theo nhịp',
  desc: 'Throttle 425ms khớp animation gửi tin, xả ở cuối tick, tin mới mở nhịp mới để hiện ngay',
  order: 104,
  load: () => import('../TgUpdateBatchingDemo'),
} satisfies DemoRegistration;
