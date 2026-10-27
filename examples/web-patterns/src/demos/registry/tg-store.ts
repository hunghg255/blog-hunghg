import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'tg-store',
  title: 'Telegram #5: store tự viết và danh sách có key',
  desc: 'setGlobal gom theo frame, so sánh nông, cảnh báo NaN; cập nhật danh sách bằng fragment, ít thao tác DOM.',
  order: 105,
  load: () => import('../TgStoreDemo'),
} satisfies DemoRegistration;
