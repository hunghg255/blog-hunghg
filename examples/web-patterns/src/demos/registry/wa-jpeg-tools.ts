import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'wa-jpeg-tools',
  title: 'WhatsApp #3: xoá EXIF, thumbnail theo ngân sách',
  desc: 'Bỏ Exif/GPS bằng cách chép segment JPEG (điểm ảnh không đổi), nén thumbnail vừa 20 KB bằng tìm nhị phân, kiểm frame đen bằng lưới',
  order: 303,
  load: () => import('../WaJpegToolsDemo'),
} satisfies DemoRegistration;
