import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'caret-autocomplete',
  title: 'Autocomplete tại con trỏ',
  desc: '@mention và :emoji: ở bất kỳ đâu trong contenteditable, xoá đúng một grapheme',
  order: 21,
  load: () => import('../CaretAutocompleteDemo'),
} satisfies DemoRegistration;
