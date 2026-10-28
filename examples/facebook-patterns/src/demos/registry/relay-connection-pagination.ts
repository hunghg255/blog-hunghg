import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'relay-connection-pagination',
  title: 'Phân trang connection: cursor khớp đầu, edge không trùng',
  desc: 'Bấm tải tiếp hai lần, trang lẫn bài cũ, tải bài mới hơn: nối thẳng mảng so với ConnectionHandler của Relay',
  order: 90,
  load: () => import('../ConnectionDemo'),
} satisfies DemoRegistration;
