import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'crop-geometry',
  title: 'Crop đúng tỉ lệ, xoay sticker trong vùng an toàn',
  desc: 'Crop giữa ảnh theo 1.91:1, 1:1, 4:5, 9:16; khớp khoá kích thước; sticker xoay và khoảng vị trí hợp lệ',
  order: 82,
  load: () => import('../CropGeometryDemo'),
} satisfies DemoRegistration;
