import type { DemoRegistration } from '../../demoRegistry';
export default {
  route: 'wa-price',
  title: 'WhatsApp #18: parse giá tiền theo locale bằng Intl',
  desc: 'So sánh cách WhatsApp Web 2020 đọc giá với bản dùng formatToParts: es, pl, de, fr, vi, en-IN, Ả Rập.',
  order: 318,
  load: () => import('../WaPriceParseDemo'),
} satisfies DemoRegistration;
