import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'ot-binding',
  title: 'OT + editor: undo và chặn echo',
  desc: 'Hai người sửa chung qua server có độ trễ; undo stack được transform theo op của người khác (Glitch)',
  order: 47,
  load: () => import('../OtBindingDemo'),
} satisfies DemoRegistration;
