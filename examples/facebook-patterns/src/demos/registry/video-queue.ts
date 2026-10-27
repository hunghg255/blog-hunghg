import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'video-queue',
  title: 'Hàng đợi lệnh video, stream sắp lại chunk',
  desc: 'Nén play/pause/seek, chunk lệch thứ tự, phát lại cho người đến muộn',
  order: 57,
  load: () => import('../VideoQueueDemo'),
} satisfies DemoRegistration;
