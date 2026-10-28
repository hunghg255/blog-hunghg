import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'semver-range',
  title: 'Tự cài semver range',
  desc: 'VersionRange kiểu Facebook trả sai với ^, AND bằng dấu cách và prerelease; bản viết lại khớp npm semver',
  order: 72,
  load: () => import('../SemverRangeDemo'),
} satisfies DemoRegistration;
