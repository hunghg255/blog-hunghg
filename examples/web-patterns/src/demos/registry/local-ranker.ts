import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'local-ranker',
  title: 'Xếp hạng gợi ý trên client',
  desc: 'Trie + model xếp hạng chạy trong trình duyệt, so ngầm top-5 với server và chép feature mới (Outlook)',
  order: 46,
  load: () => import('../LocalRankerDemo'),
} satisfies DemoRegistration;
