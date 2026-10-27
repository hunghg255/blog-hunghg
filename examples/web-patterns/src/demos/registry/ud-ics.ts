import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'ud-ics',
  title: 'Udemy: file .ics có VTIMEZONE',
  desc: 'Sinh file lịch nhắc học đúng múi giờ, CRLF, escape, tên file tiếng Việt (Udemy)',
  order: 213,
  load: () => import('../UdIcsDemo'),
} satisfies DemoRegistration;
