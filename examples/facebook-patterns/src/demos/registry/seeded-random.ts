import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'seeded-random',
  title: 'PRNG có seed và lấy mẫu trace',
  desc: 'Alea, xáo trộn tái lập theo người dùng, chia nhóm A/B, lấy mẫu 1/32',
  order: 66,
  load: () => import('../SeededRandomDemo'),
} satisfies DemoRegistration;
