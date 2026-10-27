import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'ud-media-expiry',
  title: 'Udemy #2: URL ký và license hết hạn',
  desc: 'URL ký sống 4 giờ, token license 5 phút: hết hạn phần nào tải lại phần đó, player lỗi thì làm mới, tải trước bài kế',
  order: 202,
  load: () => import('../UdMediaExpiryDemo'),
} satisfies DemoRegistration;
