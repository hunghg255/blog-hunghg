import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'tg-persist-state',
  title: 'Telegram #3: lưu global state lúc rảnh',
  desc: 'Gom ghi 5 giây rồi chờ lúc rảnh, hoãn khi có animation nặng, cắt tỉa còn 30 chat và tin đang hiện, mở lại app hiện ngay từ cache',
  order: 103,
  load: () => import('../TgPersistStateDemo'),
} satisfies DemoRegistration;
