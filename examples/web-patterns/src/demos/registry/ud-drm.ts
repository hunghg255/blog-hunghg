import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'ud-drm',
  title: 'Udemy #1: DRM đa hệ',
  desc: 'Dò Widevine/PlayReady/FairPlay bằng requestMediaKeySystemAccess, chọn theo thứ tự, định dạng license request riêng cho từng hệ',
  order: 201,
  load: () => import('../UdDrmDemo'),
} satisfies DemoRegistration;
