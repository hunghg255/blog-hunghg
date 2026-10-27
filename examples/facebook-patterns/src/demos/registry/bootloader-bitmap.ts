import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'bootloader-bitmap',
  title: 'Bitmap tài nguyên + client consistency',
  desc: 'Báo server tài nguyên đã có, chỉ reload khi code đang dùng bị đổi',
  order: 28,
  load: () => import('../BootloaderDemo'),
} satisfies DemoRegistration;
