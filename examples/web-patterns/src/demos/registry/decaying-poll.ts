import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'decaying-poll',
  title: 'Polling thưa dần và debounce động',
  desc: 'Poll nhanh lúc đầu, chậm dần rồi dừng, tự nhanh lại khi người dùng quay lại; debounce chờ lâu hơn với query ngắn (Trello)',
  order: 36,
  load: () => import('../DecayingPollDemo'),
} satisfies DemoRegistration;
