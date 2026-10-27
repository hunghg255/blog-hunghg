import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'ud-video-quirks',
  title: 'Udemy: đo băng thông, forcePlay, iPad giả Mac',
  desc: 'High-watermark từ bộ đếm byte đã giải mã, ép tải bằng phát tắt tiếng, nhận ra iPadOS (Udemy)',
  order: 206,
  load: () => import('../UdVideoQuirksDemo'),
} satisfies DemoRegistration;
