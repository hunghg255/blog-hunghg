import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'markup-compiler',
  title: 'Markup riêng ↔ HTML',
  desc: 'HTML → CML chỉ giữ thẻ được phép, CML → HTML dựng bằng DOM, chặn javascript: và tên miền giả (Coursera)',
  order: 48,
  load: () => import('../MarkupCompilerDemo'),
} satisfies DemoRegistration;
