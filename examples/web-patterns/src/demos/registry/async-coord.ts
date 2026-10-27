import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'async-coord',
  title: 'Điều phối async: latest-wins, single-flight',
  desc: 'Slider điều khiển việc lưu chậm, nhiều widget chung một request, chạy đúng một lần khi hết giờ, hàng đợi lệnh cho script bên thứ ba (Glitch, Toptal)',
  order: 35,
  load: () => import('../AsyncCoordDemo'),
} satisfies DemoRegistration;
