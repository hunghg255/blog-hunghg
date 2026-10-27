import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'ud-badges',
  title: 'Udemy: Open Badges giấu trong ảnh',
  desc: 'Nướng và đọc assertion trong chunk iTXt của PNG và trong SVG (Udemy)',
  order: 214,
  load: () => import('../UdBadgesDemo'),
} satisfies DemoRegistration;
