import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'intl-kit',
  title: 'Intl thực chiến',
  desc: 'Cắt mô tả theo câu, số rút gọn theo locale, số nhiều đúng CLDR, chọn locale gần nhất (Apple, Outlook)',
  order: 50,
  load: () => import('../IntlKitDemo'),
} satisfies DemoRegistration;
