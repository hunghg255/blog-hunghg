import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'menu-aim',
  title: 'menuAim: rê chéo vào submenu không bị đóng',
  desc: 'Hai tam giác SVG che các mục bên cạnh khi chuột đang nhắm tới submenu (Udemy)',
  order: 27,
  load: () => import('../MenuAimDemo'),
} satisfies DemoRegistration;
