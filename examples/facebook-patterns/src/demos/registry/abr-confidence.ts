import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'abr-confidence',
  title: 'ABR theo độ tự tin phát',
  desc: 'Điểm tự tin từng bậc bitrate, buffer cạn thì đòi dư băng thông, cắt bậc theo MOS',
  order: 59,
  load: () => import('../AbrConfidenceDemo'),
} satisfies DemoRegistration;
