import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'multikey-memo',
  title: 'Memo nhiều khoá, interning, gom request',
  desc: 'Trie Map/WeakMap có tỉa nút, LoadState dùng chung object, gom 30 lời gọi thành 2 request',
  order: 68,
  load: () => import('../MultiKeyMemoDemo'),
} satisfies DemoRegistration;
