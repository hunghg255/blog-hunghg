import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'feature-probe-tricks',
  title: 'Dò tính năng: ảnh EXIF 2×1, getter bẫy, thanh cuộn',
  desc: 'Sinh JPEG 2×1 có EXIF Orientation 6 ngay trên trang để dò tự xoay; getter bẫy cho User Timing L3; đo thanh cuộn, bẫy once() và ResizeObserver dùng chung',
  order: 103,
  load: () => import('../FeatureProbesDemo'),
} satisfies DemoRegistration;
