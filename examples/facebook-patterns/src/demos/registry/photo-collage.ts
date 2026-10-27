import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'photo-collage',
  title: 'Bố cục collage ảnh',
  desc: 'Chấm điểm độ cắt xén để chọn bố cục, focal point',
  order: 17,
  load: () => import('../PhotoCollageDemo'),
} satisfies DemoRegistration;
