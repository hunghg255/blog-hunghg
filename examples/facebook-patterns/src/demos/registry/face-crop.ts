import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'face-crop',
  title: 'Crop ảnh theo nhiều khuôn mặt',
  desc: 'Cửa sổ chứa nhiều mặt nhất, bug của bản gốc, đổi toạ độ khi xoay',
  order: 34,
  load: () => import('../FaceCropDemo'),
} satisfies DemoRegistration;
