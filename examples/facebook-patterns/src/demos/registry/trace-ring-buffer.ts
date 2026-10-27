import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'trace-ring-buffer',
  title: 'Ring buffer cho nhiều trace',
  desc: 'Một buffer chung, mỗi trace biết mình đã mất log hay chưa',
  order: 26,
  load: () => import('../TraceRingBufferDemo'),
} satisfies DemoRegistration;
