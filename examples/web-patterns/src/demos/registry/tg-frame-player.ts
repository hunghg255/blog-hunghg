import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'tg-frame-player',
  title: 'Player khung hình kiểu RLottie',
  desc: 'Độ phân giải theo DPR, hạ fps, cache khung, giữ đúng thời lượng (Telegram)',
  order: 112,
  load: () => import('../TgFramePlayerDemo'),
} satisfies DemoRegistration;
