import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'search-box',
  title: 'Ô tìm kiếm chuẩn production',
  desc: 'Debounce, huỷ request cũ, cache, khoá phím khi kết quả chưa chốt, tô đậm an toàn (Similarweb, Udemy, Pipedrive)',
  order: 34,
  load: () => import('../SearchBoxDemo'),
} satisfies DemoRegistration;
