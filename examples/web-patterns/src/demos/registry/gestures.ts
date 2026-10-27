import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'gestures',
  title: 'Kéo, vuốt chung cho chuột và cảm ứng',
  desc: 'Ngưỡng 15/50px, bỏ vuốt chéo, khoá trục; viết lại bằng Pointer Events + setPointerCapture (Telegram)',
  order: 28,
  load: () => import('../GesturesDemo'),
} satisfies DemoRegistration;
