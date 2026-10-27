import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'quota-storage',
  title: 'localStorage tự dọn khi đầy quota',
  desc: 'Đầy thì xoá nửa entry cũ nhất; bản gốc xoá nhầm key của code khác',
  order: 52,
  load: () => import('../QuotaStorageDemo'),
} satisfies DemoRegistration;
