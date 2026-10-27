import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'plugin-composer',
  title: 'Composer dạng plugin',
  desc: 'Mỗi plugin tự đăng ký reducer, dirty checker, validator, pre-submit hook',
  order: 43,
  load: () => import('../ComposerDemo'),
} satisfies DemoRegistration;
