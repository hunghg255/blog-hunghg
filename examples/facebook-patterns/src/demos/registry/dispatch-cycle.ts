import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'dispatch-cycle',
  title: 'Flux waitFor tự viết và proxy có đệm',
  desc: 'Bỏ waitFor thì tổng ngân sách sai; tạo vòng để thấy cả chuỗi; gọi logger trước khi tải xong',
  order: 81,
  load: () => import('../DispatchCycleDemo'),
} satisfies DemoRegistration;
