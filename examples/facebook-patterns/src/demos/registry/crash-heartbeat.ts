import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'crash-heartbeat',
  title: 'Phát hiện crash qua heartbeat, dò proxy cache hỏng',
  desc: '4 tab mô phỏng ghi heartbeat chung một khoá; chỉ một tab báo mỗi crash; so cookie với user id trong HTML',
  order: 79,
  load: () => import('../CrashHeartbeatDemo'),
} satisfies DemoRegistration;
