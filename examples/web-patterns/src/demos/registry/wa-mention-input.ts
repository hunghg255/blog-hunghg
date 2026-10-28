import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'wa-mention-input',
  title: 'WhatsApp #12: mention bằng token zero-width',
  desc: 'Ô soạn tin contentEditable: @mention lưu thành ZW+jid+ZW, gửi đi "@số" + danh sách jid, giới hạn độ dài theo code point.',
  order: 312,
  load: () => import('../WaMentionInputDemo'),
} satisfies DemoRegistration;
