import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'message-grouping',
  title: 'Gom tin nhắn thành cụm, vạch thời gian và avatar đã xem',
  desc: 'Khung chat giả: chỉnh ngưỡng gom, mốc đã đọc của từng người để thấy cụm tách/gộp và avatar "đã xem" di chuyển',
  order: 96,
  load: () => import('../MessageGroupingDemo'),
} satisfies DemoRegistration;
