import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'frequency-cap',
  title: 'Giới hạn tần suất bằng bitmask (Outlook)',
  desc: 'Khi nào được hiện khảo sát/tip: bitmask điều kiện, cooldown theo kênh, chọn X% người dùng, tối đa K ngày/tuần.',
  order: 19,
  load: () => import('../FrequencyCapDemo'),
} satisfies DemoRegistration;
