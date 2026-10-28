import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'wa-ordered-keys',
  title: 'WhatsApp #7: khoá IndexedDB giữ đúng thứ tự số',
  desc: 'Tiền tố độ dài hex giúp chuỗi so sánh đúng thứ tự số; so với khoá thập phân và khoá mảng trên IndexedDB thật.',
  order: 307,
  load: () => import('../WaOrderedKeysDemo'),
} satisfies DemoRegistration;
