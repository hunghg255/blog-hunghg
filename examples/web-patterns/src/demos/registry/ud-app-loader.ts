import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'ud-app-loader',
  title: 'Udemy: nạp app theo ưu tiên, registry store, context tới muộn',
  desc: 'Tải chunk song song nhưng khởi động theo ưu tiên, registry nhớ chủ sở hữu, context lỗi thì thử lại được (Udemy)',
  order: 220,
  load: () => import('../UdAppLoaderDemo'),
} satisfies DemoRegistration;
