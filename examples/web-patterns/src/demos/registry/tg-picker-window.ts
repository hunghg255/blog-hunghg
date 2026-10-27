import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'tg-picker-window',
  title: 'Telegram #17: bảng emoji chỉ render nhóm đang xem',
  desc: 'Chiều cao tính trước, render nhóm ±1, scroll-spy chọn nhóm giữa; đóng băng sticker theo từng nguồn.',
  order: 117,
  load: () => import('../TgPickerWindowDemo'),
} satisfies DemoRegistration;
