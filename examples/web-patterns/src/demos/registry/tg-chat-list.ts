import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'tg-chat-list',
  title: 'Telegram #6: sắp xếp danh sách chat không đo DOM',
  desc: 'FLIP bằng translateY theo phần trăm chiều cao dòng; nhóm dòng ít hơn thì fade, nhóm đông hơn thì trượt.',
  order: 106,
  load: () => import('../TgChatListDemo'),
} satisfies DemoRegistration;
