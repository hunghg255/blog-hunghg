import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'ud-code-preview',
  title: 'Udemy: preview code trong iframe sandbox',
  desc: 'Ghép HTML/CSS/JS, chặn vòng lặp vô hạn, chạy ở origin "null" (Udemy)',
  order: 207,
  load: () => import('../UdCodePreviewDemo'),
} satisfies DemoRegistration;
