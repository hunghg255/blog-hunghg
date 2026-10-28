import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'relay-optimistic-store',
  title: 'Store optimistic theo lớp, rebase khi server trả về',
  desc: 'Lớp phủ copy-on-write, sentinel xoá, rollback rồi áp lại update optimistic, so với rollback bằng bản chụp',
  order: 88,
  load: () => import('../OptimisticStoreDemo'),
} satisfies DemoRegistration;
