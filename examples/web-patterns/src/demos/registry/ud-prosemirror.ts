import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'ud-prosemirror',
  title: 'Udemy: editor rich text cho email và dán từ IDE',
  desc: 'Schema bật/tắt theo feature, chuẩn hoá HTML dán từ VS Code/PyCharm, giữ khoảng trắng trong email, NodeView React (Udemy)',
  order: 211,
  load: () => import('../UdProseMirrorDemo'),
} satisfies DemoRegistration;
