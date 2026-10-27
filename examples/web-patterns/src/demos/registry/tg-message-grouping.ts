import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'tg-message-grouping',
  title: 'Telegram #16: ô nhập tự giãn, emoji to, gom tin',
  desc: 'Đo chiều cao bằng bản sao ẩn, thời lượng tỉ lệ log; tin chỉ có emoji phóng to; gom theo ngày, người gửi, album.',
  order: 116,
  load: () => import('../TgMessageGroupingDemo'),
} satisfies DemoRegistration;
