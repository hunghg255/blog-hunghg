import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'chunked-upload',
  title: 'Upload file lớn theo lát (Outlook, Tribe)',
  desc: 'Lát đầu chạy trước, lát giữa song song, lát cuối chốt; thử lại từng lát, huỷ thật sự; đọc lỗi XML của S3.',
  order: 38,
  load: () => import('../ChunkedUploadDemo'),
} satisfies DemoRegistration;
