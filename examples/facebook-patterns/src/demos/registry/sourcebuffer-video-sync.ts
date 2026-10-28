import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'sourcebuffer-video-sync',
  title: 'SourceBuffer và đồng bộ video',
  desc: 'Hàng đợi append có gom chunk, lỗi .buffer của subarray; giữ video khớp animation bằng playbackRate',
  order: 95,
  load: () => import('../VideoSyncDemo'),
} satisfies DemoRegistration;
