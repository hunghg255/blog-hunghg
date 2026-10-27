import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'above-fold',
  title: 'Đo phần đầu màn hình hiển thị xong',
  desc: 'MutationObserver + sự kiện load của ảnh trong khung nhìn, cả khi chuyển trang SPA; độ trễ khi bấm; tách Resource Timing (Zappos, Outlook, Best Buy)',
  order: 60,
  load: () => import('../AboveFoldDemo'),
} satisfies DemoRegistration;
