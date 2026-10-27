import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'currency',
  title: 'Tiền tệ theo đơn vị nhỏ nhất',
  desc: 'Offset theo loại tiền, ít nhất một chữ số có nghĩa, ô nhập giữ chuỗi đang gõ, dán đôi',
  order: 49,
  load: () => import('../CurrencyDemo'),
} satisfies DemoRegistration;
