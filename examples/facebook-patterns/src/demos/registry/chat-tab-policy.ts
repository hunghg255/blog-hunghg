import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'chat-tab-policy',
  title: 'Tab chat vừa màn hình, chuỗi luật mở tab, hẹn giờ bỏ mute',
  desc: 'Kéo độ rộng cửa sổ, nhận tin từ nhiều người: tab có chữ soạn dở không bị thay; tám luật đồng bộ/bất đồng bộ; setTimeout quá 24,8 ngày',
  order: 97,
  load: () => import('../ChatTabPolicyDemo'),
} satisfies DemoRegistration;
