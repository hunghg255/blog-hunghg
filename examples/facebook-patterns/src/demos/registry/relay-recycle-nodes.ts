import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'relay-recycle-nodes',
  title: 'Giữ nguyên tham chiếu nhánh không đổi',
  desc: 'recycleNodesInto của Relay: refetch JSON mới mà React.memo vẫn bỏ qua render, kèm ca lệch khoá và Map',
  order: 87,
  load: () => import('../RecycleNodesDemo'),
} satisfies DemoRegistration;
