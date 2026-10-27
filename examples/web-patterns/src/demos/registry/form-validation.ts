import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'form-validation',
  title: 'Validate form thân thiện',
  desc: 'Mật khẩu theo ký tự khác nhau, ngày có thật, trường bắt buộc phải điền được',
  order: 4,
  load: () => import('../FormValidationDemo'),
} satisfies DemoRegistration;
