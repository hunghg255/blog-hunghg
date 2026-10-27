import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'css-bridge',
  title: 'CSS nói, JS nghe: breakpoint và chế độ hiển thị',
  desc: 'JS đọc số cột từ z-index của ::after (Ello) hoặc custom property, theo dõi bằng ResizeObserver; phát hiện PWA bằng display-mode (App Store)',
  order: 57,
  load: () => import('../CssBridgeDemo'),
} satisfies DemoRegistration;
