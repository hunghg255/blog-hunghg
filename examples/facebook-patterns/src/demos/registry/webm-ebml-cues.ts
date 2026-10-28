import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'webm-ebml-cues',
  title: 'Đọc WebM Cues tìm byte range',
  desc: 'Parser EBML tối giản: VINT, Info, Cues → bảng segment thời gian ↔ byte range cho DASH WebM',
  order: 92,
  load: () => import('../WebmCuesDemo'),
} satisfies DemoRegistration;
