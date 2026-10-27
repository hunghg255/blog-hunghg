import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'qpl-send-rtt',
  title: 'QPL: đo RTT gửi tin, lấy mẫu, tỷ lệ mất',
  desc: 'Marker theo OTID, lấy mẫu 1/N lúc start, trackedForLoss',
  order: 40,
  load: () => import('../QplSendRttDemo'),
} satisfies DemoRegistration;
