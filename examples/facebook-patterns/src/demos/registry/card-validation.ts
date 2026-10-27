import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'card-validation',
  title: 'Validate số thẻ',
  desc: 'Sửa lỗi OCR, dò hãng theo BIN, Luhn, nhóm số theo hãng',
  order: 45,
  load: () => import('../CardValidationDemo'),
} satisfies DemoRegistration;
