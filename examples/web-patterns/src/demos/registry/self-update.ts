import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'self-update',
  title: 'SPA tự cập nhật',
  desc: 'Reload ở lần điều hướng kế tiếp khi app quá cũ / có bản mới, báo bản mới qua header API (Trello, Zappos, Elastic)',
  order: 16,
  load: () => import('../SelfUpdateDemo'),
} satisfies DemoRegistration;
