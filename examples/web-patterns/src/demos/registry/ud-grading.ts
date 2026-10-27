import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'ud-grading',
  title: 'Udemy: chấm code qua kênh realtime',
  desc: 'Subscribe trước rồi mới gửi bài, hỏi lại qua HTTP khi kênh im lặng, autosave không lưu trùng (Udemy)',
  order: 209,
  load: () => import('../UdGradingDemo'),
} satisfies DemoRegistration;
