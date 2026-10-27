import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'otid',
  title: 'OTID: ID tin nhắn sinh ở client',
  desc: '41 bit thời gian + 22 bit ngẫu nhiên, ghép tin đang gửi với bản server dội về',
  order: 39,
  load: () => import('../OtidDemo'),
} satisfies DemoRegistration;
