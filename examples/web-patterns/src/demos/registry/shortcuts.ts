import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'shortcuts',
  title: 'Phím tắt theo phạm vi',
  desc: 'Một listener cho cả app, scope cao chặn scope thấp, bỏ qua IME và ô nhập, map bàn phím Nga/Trung (Trello)',
  order: 29,
  load: () => import('../ShortcutsDemo'),
} satisfies DemoRegistration;
