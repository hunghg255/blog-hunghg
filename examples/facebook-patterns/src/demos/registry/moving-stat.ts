import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'moving-stat',
  title: 'Cửa sổ trượt và khoảng thời gian',
  desc: 'MovingStat kiểu Facebook giữ số liệu cũ sau khi im lặng; đếm tháng theo lịch so với chia 30 ngày; gộp lịch bận',
  order: 69,
  load: () => import('../MovingStatDemo'),
} satisfies DemoRegistration;
