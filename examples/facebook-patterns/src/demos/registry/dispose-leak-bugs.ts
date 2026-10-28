import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'dispose-leak-bugs',
  title: 'Dispose cho đúng: listener, idle callback, subscription',
  desc: 'splice(-1) xoá nhầm listener, filter ngược, Map idle không bao giờ xoá, subscription mở lại sau dispose, throttle chạy sau unmount',
  order: 105,
  load: () => import('../DisposeSafeDemo'),
} satisfies DemoRegistration;
