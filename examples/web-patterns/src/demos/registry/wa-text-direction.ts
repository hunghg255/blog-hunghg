import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'wa-text-direction',
  title: 'WhatsApp #13: hướng chữ bằng bảng delta nén',
  desc: 'Tra ký tự mạnh đầu tiên trong bảng khoảng code point nén (~4KB) để đặt dir cho tin nhắn và tên; so với dir="auto".',
  order: 313,
  load: () => import('../WaTextDirectionDemo'),
} satisfies DemoRegistration;
