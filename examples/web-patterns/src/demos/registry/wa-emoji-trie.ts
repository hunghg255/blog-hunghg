import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'wa-emoji-trie',
  title: 'WhatsApp #11: emoticon → emoji, tìm emoji',
  desc: 'Trie đọc ngược thay :-) khi gõ, Backspace trả lại chữ gốc; tìm emoji bằng trie tiền tố 5 ký tự và xếp hạng gần đây/phổ biến.',
  order: 311,
  load: () => import('../WaEmojiTrieDemo'),
} satisfies DemoRegistration;
