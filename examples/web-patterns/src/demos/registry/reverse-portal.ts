import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'reverse-portal',
  title: 'Reverse portal (Zappos)',
  desc: 'Đổi chỗ một widget giữa hai vị trí mà không remount: giữ state React, input, iframe.',
  order: 17,
  load: () => import('../ReversePortalDemo'),
} satisfies DemoRegistration;
