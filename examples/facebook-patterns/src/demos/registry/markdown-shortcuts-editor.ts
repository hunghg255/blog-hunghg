import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'markdown-shortcuts-editor',
  title: 'Phím tắt Markdown trong editor, Backspace để hoàn tác',
  desc: 'Gõ "# ", "- ", "[ ] " ở đầu dòng để đổi kiểu block, Backspace ngay sau đó để lấy lại chữ; dán Markdown nhiều dòng so với bản gốc',
  order: 98,
  load: () => import('../MarkdownShortcutsDemo'),
} satisfies DemoRegistration;
