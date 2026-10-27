import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'jpeg-resize',
  title: 'Resize ảnh trong pool worker',
  desc: 'Round-robin vs ít việc nhất, worker crash, so với main thread',
  order: 33,
  load: () => import('../JpegResizeDemo'),
} satisfies DemoRegistration;
