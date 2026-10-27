import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'transcript',
  title: 'WebVTT và transcript tương tác',
  desc: 'Kiểm tra file phụ đề báo đủ lỗi kèm số dòng, bôi chọn transcript lưu theo toạ độ cue (Udemy, Coursera)',
  order: 51,
  load: () => import('../TranscriptDemo'),
} satisfies DemoRegistration;
