import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'bandwidth-ewma',
  title: 'Ước lượng băng thông EWMA',
  desc: 'Half-life theo giây tải, loại outlier, nhớ qua phiên, cổng autoplay mở lại sớm',
  order: 58,
  load: () => import('../BandwidthEwmaDemo'),
} satisfies DemoRegistration;
