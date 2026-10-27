import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'bulk-edit',
  title: 'Sửa hàng loạt và seen/read bằng 2 bit',
  desc: 'Form Empty/Uniform/Mixed cho N dòng; XOR tách sự kiện seen và read',
  order: 50,
  load: () => import('../BulkEditDemo'),
} satisfies DemoRegistration;
