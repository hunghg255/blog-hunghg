import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'wa-render-cursor',
  title: 'WhatsApp #8: cửa sổ render theo chiều cao ước lượng',
  desc: 'Nới cửa sổ tin nhắn vừa đủ 2 màn hình bằng chiều cao đoán trước; bật cách tính cũ để thấy NaN.',
  order: 308,
  load: () => import('../WaRenderCursorDemo'),
} satisfies DemoRegistration;
