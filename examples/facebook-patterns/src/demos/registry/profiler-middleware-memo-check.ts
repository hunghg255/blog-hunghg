import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'profiler-middleware-memo-check',
  title: 'Profiler kiểu middleware và memo selector có canary',
  desc: 'Chuỗi handler của RelayProfiler (quên next, next hai lần, frame kẹt khi lỗi) và memo selector kiểm chứng bằng lấy mẫu',
  order: 91,
  load: () => import('../ProfilerChainDemo'),
} satisfies DemoRegistration;
