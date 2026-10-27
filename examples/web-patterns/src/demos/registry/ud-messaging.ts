import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'ud-messaging',
  title: 'Udemy: trả lời lạc quan có rollback, autocomplete hai tầng',
  desc: 'Tin tạm tìm theo id thay vì vị trí, tin lỗi có nút gửi lại; cache theo tiền tố, lọc trên client (Udemy)',
  order: 219,
  load: () => import('../UdMessagingDemo'),
} satisfies DemoRegistration;
