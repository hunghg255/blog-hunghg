import type { DemoRegistration } from '../../demoRegistry';
export default {
  route: 'wa-pip',
  title: 'WhatsApp #17: cửa sổ PiP resize 8 hướng, né vật cản',
  desc: 'Resize 8 hướng giữ tỉ lệ, kéo trong khung, tự né menu theo hướng ngắn nhất.',
  order: 317,
  load: () => import('../WaPipDemo'),
} satisfies DemoRegistration;
