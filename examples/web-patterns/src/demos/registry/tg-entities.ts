import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'tg-entities',
  title: 'Telegram #15: rich text ⇄ entities',
  desc: 'contenteditable đổi qua lại { text, entities }, thanh định dạng nổi, markdown nhanh, nháp theo chat không lưu nhầm.',
  order: 115,
  load: () => import('../TgEntitiesDemo'),
} satisfies DemoRegistration;
