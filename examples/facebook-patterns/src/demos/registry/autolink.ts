import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'autolink',
  title: 'Auto-link URL và cắt chữ an toàn',
  desc: 'Ngoặc cân bằng, Xem thêm không chặt URL, chặn LaTeX lồng sâu, dấu ＃',
  order: 73,
  load: () => import('../AutolinkDemo'),
} satisfies DemoRegistration;
