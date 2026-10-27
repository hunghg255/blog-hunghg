import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'tg-bubble-meta',
  title: 'Giờ gửi nằm gọn trong bong bóng chat',
  desc: 'Meta float trong đoạn text hoặc ::after giữ chỗ, không cần JS đo layout (Telegram)',
  order: 109,
  load: () => import('../TgBubbleMetaDemo'),
} satisfies DemoRegistration;
