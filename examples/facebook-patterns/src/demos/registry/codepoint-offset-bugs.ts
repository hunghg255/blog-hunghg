import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'codepoint-offset-bugs',
  title: 'Offset theo code point hay UTF-16: bốn bug cùng một gốc',
  desc: 'Mention, link r/…, URL có emoji phía trước: bản gốc lệch offset và sinh range ngoài chuỗi; tin chỉ có emoji hiện cỡ lớn',
  order: 99,
  load: () => import('../CodepointOffsetDemo'),
} satisfies DemoRegistration;
