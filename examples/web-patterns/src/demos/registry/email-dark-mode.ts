import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'email-dark-mode',
  title: 'Dark mode cho email HTML',
  desc: 'Đổi màu trong CIELAB, chỉ sửa chỗ thiếu tương phản, copy ra vẫn giữ màu gốc',
  order: 22,
  load: () => import('../EmailDarkModeDemo'),
} satisfies DemoRegistration;
