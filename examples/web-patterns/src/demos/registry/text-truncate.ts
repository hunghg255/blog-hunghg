import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'text-truncate',
  title: 'Cắt chữ nhiều dòng chính xác',
  desc: 'Đo chữ bằng canvas để cắt theo từ, badge dính từ cuối, chống từ mồ côi (Pipedrive, Apple, Toptal)',
  order: 25,
  load: () => import('../TextTruncateDemo'),
} satisfies DemoRegistration;
