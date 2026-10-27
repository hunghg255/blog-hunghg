import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'tg-audio-player',
  title: 'Telegram #19: trình phát audio toàn cục',
  desc: 'Track sống ngoài component, phát tiếp khi đổi chat, danh sách theo thứ tự tin; nhả bộ nhớ media, poster video ở client.',
  order: 119,
  load: () => import('../TgAudioPlayerDemo'),
} satisfies DemoRegistration;
