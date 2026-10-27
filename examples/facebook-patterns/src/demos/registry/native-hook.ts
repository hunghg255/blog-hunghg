import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'native-hook',
  title: 'Kiểm tra API native có bị bọc không',
  desc: 'Hook giả toString lừa được fn.toString(), không lừa được realm sạch',
  order: 51,
  load: () => import('../NativeHookDemo'),
} satisfies DemoRegistration;
