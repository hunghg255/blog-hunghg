import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'typeahead-stable-results',
  title: 'Typeahead không nhảy: cache tiền tố, chặn reflow, khoá hover',
  desc: 'Cache kết quả theo tiền tố và lỗi trim; ba nguồn trả về lệch giờ, có và không có luật chống đẩy; cuộn bằng phím mà hover không cướp mục chọn',
  order: 100,
  load: () => import('../StableTypeaheadDemo'),
} satisfies DemoRegistration;
