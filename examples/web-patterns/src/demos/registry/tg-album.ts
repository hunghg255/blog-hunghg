import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'tg-album',
  title: 'Telegram #8: bố cục album chọn theo hàm chi phí',
  desc: 'Luật tay cho 2–4 ảnh, vét cạn 2–4 hàng cho 5+ ảnh; xem mọi phương án và chi phí của chúng.',
  order: 108,
  load: () => import('../TgAlbumDemo'),
} satisfies DemoRegistration;
