import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'file-sniff',
  title: 'Magic number, EXIF và dán ảnh',
  desc: 'Nhận loại file thật từ vài byte đầu, đọc EXIF orientation, lấy ảnh từ sự kiện paste (Ello)',
  order: 5,
  load: () => import('../FileSniffDemo'),
} satisfies DemoRegistration;
