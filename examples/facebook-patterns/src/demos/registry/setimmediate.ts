import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'setimmediate',
  title: 'setImmediate tự viết, gom delta chuột theo frame',
  desc: 'Chuỗi 300 việc: setTimeout(0) vs rút cạn kiểu FB vs bản viết lại; kéo thả xử lý từng sự kiện vs mỗi frame',
  order: 78,
  load: () => import('../ImmediateDemo'),
} satisfies DemoRegistration;
