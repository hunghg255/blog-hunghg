import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'scale-to-fit',
  title: 'Thu nhỏ bảng rộng cho vừa khung',
  desc: 'transform: scale + wrapper bù chiều cao, đợi ảnh tải, tính lại khi khung đổi cỡ, vá font emoji',
  order: 23,
  load: () => import('../ScaleToFitDemo'),
} satisfies DemoRegistration;
