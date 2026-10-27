import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'popover',
  title: 'Popover, tooltip group, hovercard',
  desc: 'Double-translate, auto-flip, tooltip "ấm", hovercard xuyên portal',
  order: 12,
  load: () => import('../PopoverDemo'),
} satisfies DemoRegistration;
