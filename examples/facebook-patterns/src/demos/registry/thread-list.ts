import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'thread-list',
  title: 'Thread list theo mốc thời gian',
  desc: 'Xin một khoảng, thiếu thì chờ đủ rồi mới vẽ; presence có version',
  order: 42,
  load: () => import('../ThreadListDemo'),
} satisfies DemoRegistration;
