import type { DemoRegistration } from '../../demoRegistry';
export default {
  route: 'wa-fps',
  title: 'WhatsApp #16: đo FPS phát hiện đóng băng, idle monitor',
  desc: 'Phát hiện UI đóng băng bằng FPS trung bình so với đo độ dài khung; khi nào coi là rời máy.',
  order: 316,
  load: () => import('../WaFpsMonitorDemo'),
} satisfies DemoRegistration;
