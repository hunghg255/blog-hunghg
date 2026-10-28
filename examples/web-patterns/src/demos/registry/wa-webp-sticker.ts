import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'wa-webp-sticker',
  title: 'WhatsApp #4: metadata sticker WebP động',
  desc: 'Dựng sticker WebP động bằng byte, đọc thời lượng, frame đầu và emoji bằng cách đi theo chunk RIFF; so với offset cố định 44 của bản gốc',
  order: 304,
  load: () => import('../WaWebpStickerDemo'),
} satisfies DemoRegistration;
