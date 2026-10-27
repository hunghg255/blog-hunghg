import type { ComponentType } from 'react';

/** Mỗi file trong demos/registry/ export default một object kiểu này. */
export interface DemoRegistration {
  /** hash route, vd 'chat-scroller' -> #/chat-scroller */
  route: string;
  title: string;
  desc: string;
  /** thứ tự trong trang danh sách demo */
  order: number;
  load: () => Promise<{ default: ComponentType }>;
}
