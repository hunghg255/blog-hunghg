import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'tg-tiny-thumb',
  title: 'Thumbnail 100 byte và viền sticker nén',
  desc: 'JPEG bỏ header dùng chung, ghép lại ở client; path SVG nén 1 byte mỗi token (Telegram)',
  order: 111,
  load: () => import('../TgTinyThumbDemo'),
} satisfies DemoRegistration;
