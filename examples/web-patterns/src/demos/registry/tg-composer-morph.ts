import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'tg-composer-morph',
  title: 'Composer biến hình, Transition, gạch chân tab',
  desc: 'scaleX tính trước, giữ màn cũ khi chuyển cảnh, gạch chân trượt bằng FLIP (Telegram)',
  order: 110,
  load: () => import('../TgComposerMorphDemo'),
} satisfies DemoRegistration;
