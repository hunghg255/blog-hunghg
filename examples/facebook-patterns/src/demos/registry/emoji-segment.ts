import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'emoji-segment',
  title: 'Tách cụm emoji',
  desc: 'Máy trạng thái so với Intl.Segmenter và cách đếm ngây thơ',
  order: 55,
  load: () => import('../EmojiSegmentDemo'),
} satisfies DemoRegistration;
