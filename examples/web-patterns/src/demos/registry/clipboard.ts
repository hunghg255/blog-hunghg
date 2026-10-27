import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'clipboard',
  title: 'Clipboard: copy, cut, dán chữ thuần, dán thông minh',
  desc: 'Copy rơi về execCommand, Ctrl+C/X trên thẻ không cần bôi đen, dán chữ thuần giữ undo, lọc HTML theo thanh công cụ (Anchor, Trello, Pipedrive, Tribe)',
  order: 54,
  load: () => import('../ClipboardDemo'),
} satisfies DemoRegistration;
