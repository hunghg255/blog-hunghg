import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'countdown-tombstone',
  title: 'Countdown time-travel và tombstone giỏ hàng',
  desc: 'Một offset thời gian cho mọi banner theo lịch để QA xem trước; dòng đã xoá giữ chỗ trong giỏ (Best Buy)',
  order: 7,
  load: () => import('../CountdownTombstoneDemo'),
} satisfies DemoRegistration;
