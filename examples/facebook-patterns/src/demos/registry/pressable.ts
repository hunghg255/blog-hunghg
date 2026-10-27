import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'pressable',
  title: 'Pressable + focus-visible',
  desc: 'Hover, press-out khi kéo ra ngoài, focus ring chỉ cho bàn phím, Ctrl+click',
  order: 13,
  load: () => import('../PressableDemo'),
} satisfies DemoRegistration;
