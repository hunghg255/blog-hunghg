import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'canvas-hit-regions',
  title: 'Hit-test canvas bằng phát lại path, nét đứt theo độ dài',
  desc: 'Di chuột lên biểu đồ canvas: vùng trúng/gần của bản viết lại vs builder gốc (rect mất, cung ném lỗi); nét đứt theo trục vs theo độ dài',
  order: 101,
  load: () => import('../HitRegionsDemo'),
} satisfies DemoRegistration;
