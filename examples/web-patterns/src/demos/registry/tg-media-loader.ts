import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'tg-media-loader',
  title: 'Telegram #18: mediaLoader và spinner không chớp',
  desc: 'Gộp request theo khoá, bộ nhớ đọc đồng bộ, ảnh có sẵn thì không fade; spinner buffer debounce 200ms.',
  order: 118,
  load: () => import('../TgMediaLoaderDemo'),
} satisfies DemoRegistration;
