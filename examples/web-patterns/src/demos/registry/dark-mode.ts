import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'dark-mode',
  title: 'Dark mode không nháy',
  desc: 'Script chặn trong <head> so với áp theme sau khi hydrate',
  order: 1,
  load: () => import('../DarkModeDemo'),
} satisfies DemoRegistration;
