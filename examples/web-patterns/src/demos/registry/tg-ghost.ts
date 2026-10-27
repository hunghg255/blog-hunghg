import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'tg-ghost',
  title: 'Telegram #7: ảnh bay giữa hai cây DOM',
  desc: 'Ghost animation mở/đóng trình xem ảnh: uncover ảnh bị crop, bay ra mép khi ô đã khuất, đóng giữa chừng vẫn mượt.',
  order: 107,
  load: () => import('../TgGhostDemo'),
} satisfies DemoRegistration;
