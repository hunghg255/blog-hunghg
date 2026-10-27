import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'tg-mobile',
  title: 'Telegram: --vh, bàn phím ảo, nhấn giữ, số điện thoại',
  desc: 'Chiều cao khung nhìn trên mobile, nhấn giữ 250ms mở menu, định dạng số điện thoại theo nước (Telegram)',
  order: 113,
  load: () => import('../TgMobileDemo'),
} satisfies DemoRegistration;
