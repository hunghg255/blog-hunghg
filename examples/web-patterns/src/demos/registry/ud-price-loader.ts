import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'ud-price-loader',
  title: 'Udemy: gom request giá, cập nhật một phần khi áp mã',
  desc: 'Batch loader 250ms/10 id, id thiếu thì báo lỗi, áp mã chỉ tải lại vài khối, lần gọi mới nhất thắng (Udemy)',
  order: 218,
  load: () => import('../UdPriceLoaderDemo'),
} satisfies DemoRegistration;
