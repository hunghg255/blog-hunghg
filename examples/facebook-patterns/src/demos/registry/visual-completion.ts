import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'visual-completion',
  title: 'Visual Completion & interaction tracing',
  desc: 'Tự đo VC, Speed Index và thời điểm tương tác render xong',
  order: 19,
  load: () => import('../VisualCompletionDemo'),
} satisfies DemoRegistration;
