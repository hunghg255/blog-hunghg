import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'incremental-filter',
  title: 'Lọc tăng dần trong Web Worker',
  desc: 'Thêm điều kiện thì chỉ lọc tiếp kết quả cũ, dữ liệu nằm sẵn trong worker (Similarweb)',
  order: 45,
  load: () => import('../IncrementalFilterDemo'),
} satisfies DemoRegistration;
