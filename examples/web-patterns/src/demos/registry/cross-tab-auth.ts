import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'cross-tab-auth',
  title: 'Đồng bộ đăng nhập giữa tab',
  desc: 'Chỉ reload khi trạng thái đăng nhập đổi (Elastic) + dọn cookie trước khi vượt 16KB (InVision)',
  order: 15,
  load: () => import('../CrossTabAuthDemo'),
} satisfies DemoRegistration;
