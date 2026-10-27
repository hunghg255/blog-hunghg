import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'ud-discovery',
  title: 'Udemy: gợi ý tính năng qua nhiều phiên',
  desc: 'Máy trạng thái PASSIVE/ACTIVE/PAUSED/DORMANT/END lưu theo user (Udemy)',
  order: 216,
  load: () => import('../UdDiscoveryDemo'),
} satisfies DemoRegistration;
