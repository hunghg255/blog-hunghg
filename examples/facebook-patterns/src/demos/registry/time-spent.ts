import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'time-spent',
  title: 'Đo thời gian dùng bằng bitmap',
  desc: 'Mỗi giây hoạt động một bit, cửa sổ 64 giây, lấy mẫu theo crc32(userId) % 2003',
  order: 23,
  load: () => import('../TimeSpentDemo'),
} satisfies DemoRegistration;
