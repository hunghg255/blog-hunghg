import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'promise-cache-preload-race',
  title: 'Cache Promise gộp request, cache lỗi ngắn, đua dữ liệu nhúng sẵn',
  desc: 'Bốn component chung một request, lỗi được cache 9 giây; loader single-flight nhớ lỗi mãi và bản sửa; dữ liệu server nhúng sẵn đua với request của client',
  order: 85,
  load: () => import('../PromiseCacheDemo'),
} satisfies DemoRegistration;
