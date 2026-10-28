import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'url-privacy',
  title: 'URL, link shim và Referer',
  desc: 'Xoá token khỏi URL, link có chữ ký, click id, đổi referrer khi bấm',
  order: 77,
  load: () => import('../UrlPrivacyDemo'),
} satisfies DemoRegistration;
