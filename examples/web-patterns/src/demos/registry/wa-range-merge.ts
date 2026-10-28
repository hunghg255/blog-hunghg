import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'wa-range-merge',
  title: 'WhatsApp #2: ghép khoảng byte video',
  desc: 'Range về không theo thứ tự được ghép vào một bộ đệm, chỉ xin phần thiếu, kiểm HMAC từng khối 64 KB, khối hỏng thì tải lại',
  order: 302,
  load: () => import('../WaRangeMergeDemo'),
} satisfies DemoRegistration;
