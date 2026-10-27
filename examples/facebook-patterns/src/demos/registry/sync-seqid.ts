import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'sync-seqid',
  title: 'Đồng bộ delta theo seqID',
  desc: 'Sai thứ tự, mất gói, server ép fetch: phát hiện lỗ và đồng bộ bù theo tầng',
  order: 38,
  load: () => import('../SyncSeqIdDemo'),
} satisfies DemoRegistration;
