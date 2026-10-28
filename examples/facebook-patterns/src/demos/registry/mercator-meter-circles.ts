import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'mercator-meter-circles',
  title: 'Vòng tròn theo mét trên bản đồ Mercator',
  desc: 'Kéo tâm từ xích đạo lên cực: vòng tròn thật vs ellipse viết lại vs cách của LeafletUtils vs hình tròn ngây thơ, kèm bảng sai số',
  order: 102,
  load: () => import('../MercatorDemo'),
} satisfies DemoRegistration;
