import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'tg-drop-zone',
  title: 'Telegram: vùng thả file, nén ảnh, copy ảnh',
  desc: 'Một hay hai ô thả quyết định ở dragenter, nén ảnh 1280px trước khi gửi, copy ảnh qua ClipboardItem (Telegram)',
  order: 123,
  load: () => import('../TgDropZoneDemo'),
} satisfies DemoRegistration;
