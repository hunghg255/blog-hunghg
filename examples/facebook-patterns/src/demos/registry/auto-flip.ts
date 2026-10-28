import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'auto-flip',
  title: 'Popover tự lật',
  desc: 'Chọn phía tràn ít nhất, tránh thanh điều hướng, đặt mũi tên',
  order: 75,
  load: () => import('../AutoFlipDemo'),
} satisfies DemoRegistration;
