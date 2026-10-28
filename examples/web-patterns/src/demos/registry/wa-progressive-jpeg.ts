import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'wa-progressive-jpeg',
  title: 'WhatsApp #1: JPEG progressive + HMAC theo đoạn',
  desc: 'Ảnh mã hoá AES-CBC chia đoạn theo scan, mỗi đoạn kiểm HMAC sidecar rồi giải mã ngay nhờ mẹo khối [2,2], ảnh nét dần',
  order: 301,
  load: () => import('../WaProgressiveDemo'),
} satisfies DemoRegistration;
