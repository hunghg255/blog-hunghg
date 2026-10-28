import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'int64-text',
  title: 'Int64, decode UTF-8, offset code point',
  desc: 'ID 64-bit mất chính xác qua Number, decoder nhận overlong và kẹt vòng lặp, range lệch sau emoji',
  order: 70,
  load: () => import('../Int64TextDemo'),
} satisfies DemoRegistration;
