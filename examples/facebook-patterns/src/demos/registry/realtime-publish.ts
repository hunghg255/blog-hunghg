import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'realtime-publish',
  title: 'Tiến độ đăng realtime: snapshot + push',
  desc: 'Giữ event push chờ snapshot rồi phát lại, watchdog chuyển sang REST, gom event xoá',
  order: 48,
  load: () => import('../RealtimePublishDemo'),
} satisfies DemoRegistration;
