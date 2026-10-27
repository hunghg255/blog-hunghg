import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'smart-compose',
  title: 'Smart Compose: gợi ý chữ mờ',
  desc: 'Chỉ hỏi server khi gõ xong một từ, ẩn gợi ý khi gõ nhanh, Tab để nhận',
  order: 21,
  load: () => import('../SmartComposeDemo'),
} satisfies DemoRegistration;
