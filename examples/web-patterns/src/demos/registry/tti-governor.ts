import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'tti-governor',
  title: 'TTI governor',
  desc: 'Xếp hàng việc phụ lúc khởi động, mỗi việc một lượt, việc idle chờ trang yên; monkey đo việc nào cần sớm (Outlook)',
  order: 40,
  load: () => import('../TtiGovernorDemo'),
} satisfies DemoRegistration;
