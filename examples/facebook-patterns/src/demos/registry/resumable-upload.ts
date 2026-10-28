import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'resumable-upload',
  title: 'Upload tiếp tục được',
  desc: 'Hỏi offset rồi gửi tiếp, băm file để bỏ qua file đã có, phát hiện upload treo',
  order: 62,
  load: () => import('../ResumableUploadDemo'),
} satisfies DemoRegistration;
