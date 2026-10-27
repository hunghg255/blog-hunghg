import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'micro-frontend',
  title: 'Micro-frontend: mount theo route, URL, postMessage',
  desc: 'App cũ và app React cùng một trang tự mount/unmount theo route, truyền dữ liệu qua URL đúng cách, iframe nói chuyện với trang chứa có kiểm origin (Similarweb, InVision, HubSpot)',
  order: 64,
  load: () => import('../MicroFrontendDemo'),
} satisfies DemoRegistration;
