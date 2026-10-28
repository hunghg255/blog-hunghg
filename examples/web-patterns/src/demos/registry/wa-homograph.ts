import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'wa-homograph',
  title: 'WhatsApp #14: link homograph, tên file RTLO',
  desc: 'Tô màu chữ Kirin/Hy Lạp giả dạng Latin trong link theo ngữ cảnh người dùng; làm sạch tên file giả đuôi bằng ký tự RLO.',
  order: 314,
  load: () => import('../WaHomographDemo'),
} satisfies DemoRegistration;
