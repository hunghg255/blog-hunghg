import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'dpr-cookie',
  title: 'DPR vào cookie, che khoá SDES trong log',
  desc: 'Zoom để thấy cookie dpr đổi ngay; regex Facebook lọt khoá AES-256 và khoá kết thúc bằng /',
  order: 80,
  load: () => import('../DprCookieDemo'),
} satisfies DemoRegistration;
