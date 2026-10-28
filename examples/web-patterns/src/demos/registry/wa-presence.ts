import type { DemoRegistration } from '../../demoRegistry';
export default {
  route: 'wa-presence',
  title: 'WhatsApp #15: presence, "đang gõ" và thông báo nhóm',
  desc: 'Header không nháy trạng thái, "đang gõ" trong nhóm, im thông báo theo số thành viên.',
  order: 315,
  load: () => import('../WaPresenceDemo'),
} satisfies DemoRegistration;
