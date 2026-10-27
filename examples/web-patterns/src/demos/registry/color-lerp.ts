import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'color-lerp',
  title: 'Nội suy màu: đổi theme và nền theo cuộn',
  desc: 'Lerp từng biến CSS màu trong rAF khi đổi theme, trộn màu nền theo tỉ lệ section đang hiện (Telegram, Anchor)',
  order: 30,
  load: () => import('../ColorLerpDemo'),
} satisfies DemoRegistration;
