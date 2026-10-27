import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'focus-stack',
  title: 'Focus stack cho popup lồng nhau',
  desc: 'Đóng chuỗi popup vẫn trả focus về đúng nút, kể cả khi nút đã bị render lại; chọn vùng nhận focus theo ưu tiên (Outlook)',
  order: 53,
  load: () => import('../FocusStackDemo'),
} satisfies DemoRegistration;
