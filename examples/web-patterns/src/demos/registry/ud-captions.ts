import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'ud-captions',
  title: 'Udemy: tự chọn phụ đề, editor phụ đề có phím tắt',
  desc: 'Chọn track theo lựa chọn đã lưu → ngôn ngữ người dùng → tiếng Anh, editor dừng video khi gõ (Udemy)',
  order: 205,
  load: () => import('../UdCaptionsDemo'),
} satisfies DemoRegistration;
