import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'tg-sticky-date',
  title: 'Telegram: ngày dính, khoá cuộn khi đổi tab',
  desc: 'Nhãn ngày chỉ hiện khi đang cuộn, đổi tab không xô layout, dừng quán tính iOS (Telegram)',
  order: 122,
  load: () => import('../TgStickyDateDemo'),
} satisfies DemoRegistration;
