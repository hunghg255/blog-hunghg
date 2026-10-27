import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'image-colors',
  title: 'Lấy màu từ ảnh, chọn màu chữ',
  desc: 'Màu trung bình của hình nền và màu pill (Telegram), gradient 4 góc từ màu icon (App Store), chữ sáng hay tối theo luma và theo WCAG (Trello)',
  order: 56,
  load: () => import('../ImageColorsDemo'),
} satisfies DemoRegistration;
