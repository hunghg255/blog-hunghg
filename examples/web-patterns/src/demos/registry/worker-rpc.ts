import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'worker-rpc',
  title: 'Gọi Web Worker như hàm async (Telegram)',
  desc: 'Promise RPC qua postMessage: tiến độ, huỷ hợp tác, transfer ArrayBuffer, lỗi và worker sập.',
  order: 12,
  load: () => import('../WorkerRpcDemo'),
} satisfies DemoRegistration;
