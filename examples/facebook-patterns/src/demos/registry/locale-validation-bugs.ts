import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'locale-validation-bugs',
  title: 'Bug định dạng số và kiểm tra dữ liệu theo locale',
  desc: 'Lương 25.000đ thành 250đ, 15 km lọt ngưỡng 25 km, năm 126, SRT xuống dòng CRLF qua mặt validator, PO Box full-width: bản gốc vs bản sửa',
  order: 104,
  load: () => import('../LocaleBugsDemo'),
} satisfies DemoRegistration;
