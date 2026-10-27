import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'tg-unread',
  title: 'Telegram: tiêu đề nhấp nháy, favicon đếm tin mới',
  desc: 'Báo tin mới trên tab khi người dùng ở chỗ khác, và lệnh xoá tới trước tin nhắn (Telegram)',
  order: 124,
  load: () => import('../TgUnreadDemo'),
} satisfies DemoRegistration;
