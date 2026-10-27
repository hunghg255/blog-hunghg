import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'tg-history-islands',
  title: 'Telegram #2: lịch sử tin nhắn chia đảo',
  desc: 'Đảo chính và đảo phụ khi nhảy tới tin cũ, gộp đảo khi giao nhau, viewport từ bộ nhớ, tải trước lát kế tiếp',
  order: 102,
  load: () => import('../TgHistoryIslandsDemo'),
} satisfies DemoRegistration;
