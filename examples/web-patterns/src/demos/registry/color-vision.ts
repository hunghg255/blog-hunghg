import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'color-vision',
  title: 'Giả lập khiếm thị màu',
  desc: 'feColorMatrix lấy từ Chromium áp lên cả board, kèm kiểm tra palette bằng JS xem nhãn nào bị lẫn (Trello)',
  order: 32,
  load: () => import('../ColorVisionDemo'),
} satisfies DemoRegistration;
