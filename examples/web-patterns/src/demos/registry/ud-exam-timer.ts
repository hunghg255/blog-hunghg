import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'ud-exam-timer',
  title: 'Udemy: bài thi có giờ',
  desc: 'Đồng hồ theo giờ thật, tự dừng khi rảnh, tạm dừng bằng sendBeacon, lưu theo dấu vân tay (Udemy)',
  order: 208,
  load: () => import('../UdExamTimerDemo'),
} satisfies DemoRegistration;
