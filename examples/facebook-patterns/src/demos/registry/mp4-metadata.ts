import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'mp4-metadata',
  title: 'Đọc metadata MP4 trên client',
  desc: 'Duyệt cây hộp ISO-BMFF, góc xoay, video 360/VR180, kiểm tra trước khi upload',
  order: 61,
  load: () => import('../Mp4MetadataDemo'),
} satisfies DemoRegistration;
