import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'ui-utilities',
  title: 'Tiện ích UI: fade, sticky event, huỷ callback, tải thêm',
  desc: 'useFadeEffect, EventHolder, createCancelableFunction, CometInfiniteScrollTrigger',
  order: 36,
  load: () => import('../UiUtilitiesDemo'),
} satisfies DemoRegistration;
