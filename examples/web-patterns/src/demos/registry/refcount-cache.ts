import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'refcount-cache',
  title: 'Cache tự dọn bằng đếm tham chiếu',
  desc: 'Component giữ/nhả query, hết người giữ thì chờ rồi mới xoá field gốc và gc entity (Outlook)',
  order: 43,
  load: () => import('../RefCountCacheDemo'),
} satisfies DemoRegistration;
