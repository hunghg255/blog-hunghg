import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'chunked-stream',
  title: 'Tiền tố for(;;) và response nhiều mẩu',
  desc: 'text() đợi hết, XHR kiểu cũ, fetch stream; script tag bị kẹt',
  order: 76,
  load: () => import('../ChunkedStreamDemo'),
} satisfies DemoRegistration;
