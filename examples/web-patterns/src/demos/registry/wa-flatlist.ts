import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'wa-flatlist',
  title: 'WhatsApp #10: FlatList tái dùng key React',
  desc: '5000 chat, key React được tái dùng khi cuộn, overscan bất đối xứng, animation reorder chỉ cho cùng một item.',
  order: 310,
  load: () => import('../WaFlatListDemo'),
} satisfies DemoRegistration;
