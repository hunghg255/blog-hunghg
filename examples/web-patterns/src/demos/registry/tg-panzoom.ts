import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'tg-panzoom',
  title: 'Telegram: PanZoom bằng matrix()',
  desc: 'Zoom, kéo, chụm hai ngón bằng một transform matrix, vùng an toàn 150px và lỗi sai dấu của bản gốc (Telegram)',
  order: 121,
  load: () => import('../TgPanZoomDemo'),
} satisfies DemoRegistration;
