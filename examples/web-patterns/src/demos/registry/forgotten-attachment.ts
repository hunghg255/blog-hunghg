import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'forgotten-attachment',
  title: 'Cảnh báo quên đính kèm file',
  desc: 'Từ khoá theo ngôn ngữ, so với thư được trích dẫn, chuỗi kiểm tra trước khi gửi',
  order: 24,
  load: () => import('../ForgottenAttachmentDemo'),
} satisfies DemoRegistration;
