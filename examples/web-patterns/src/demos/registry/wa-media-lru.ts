import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'wa-media-lru',
  title: 'WhatsApp #5: kho media LRU theo quota',
  desc: 'Cache API làm kho media LRU: đuổi mục ít dùng, đọc không ghi lại file, co theo storage.estimate, co nửa khi QuotaExceeded',
  order: 305,
  load: () => import('../WaMediaLruDemo'),
} satisfies DemoRegistration;
