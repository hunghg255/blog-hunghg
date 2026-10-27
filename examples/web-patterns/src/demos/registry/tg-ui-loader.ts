import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'tg-ui-loader',
  title: 'Telegram: UiLoader đua 700ms, ba mức animation',
  desc: 'Màn tải không chờ quá 700ms, mặt nạ khung giả, class animation-level trên body (Telegram)',
  order: 120,
  load: () => import('../TgUiLoaderDemo'),
} satisfies DemoRegistration;
