import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'artwork-preconnect',
  title: 'srcset từ template URL + preconnect (Apple)',
  desc: 'Sinh srcset/sizes theo profile, xem trình duyệt chọn ảnh nào và gom origin để preconnect.',
  order: 9,
  load: () => import('../ArtworkDemo'),
} satisfies DemoRegistration;
