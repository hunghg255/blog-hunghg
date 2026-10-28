import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'retry-backoff-schedules',
  title: 'Lịch retry: backoff có trần, Fibonacci, báo lỗi CDN mỗi N ngày',
  desc: '1000 client retry với jitter ±50 ms và full jitter; poll manifest live bỏ qua delay Fibonacci và bản sửa; giới hạn báo lỗi CDN bằng số ngày trong cookie',
  order: 86,
  load: () => import('../RetrySchedulesDemo'),
} satisfies DemoRegistration;
