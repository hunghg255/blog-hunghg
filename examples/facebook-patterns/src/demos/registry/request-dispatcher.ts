import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'request-dispatcher',
  title: 'Bộ điều phối request bảy chế độ',
  desc: 'Cùng một loạt lệnh, mỗi chế độ ra số request khác nhau',
  order: 41,
  load: () => import('../RequestDispatcherDemo'),
} satisfies DemoRegistration;
