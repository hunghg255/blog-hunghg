import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'wa-blob-cache',
  title: 'WhatsApp #6: cache blob có refcount, tự revoke objectURL',
  desc: 'LRU theo dung lượng, ghim ảnh đang hiện, một objectURL dùng chung cho mỗi blob, revoke khi đẩy ra.',
  order: 306,
  load: () => import('../WaBlobCacheDemo'),
} satisfies DemoRegistration;
