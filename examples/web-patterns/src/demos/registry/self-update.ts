import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'self-update',
  title: 'SPA tự cập nhật',
  desc: 'Reload ở lần điều hướng kế tiếp khi app quá cũ / có bản mới, chừa chuyển cảnh nhạy cảm (Trello, Zappos)',
  order: 16,
  load: () => import('../SelfUpdateDemo'),
} satisfies DemoRegistration;
