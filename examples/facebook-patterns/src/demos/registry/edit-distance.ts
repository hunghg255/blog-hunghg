import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'edit-distance',
  title: 'Damerau-Levenshtein, tự sửa tên gõ sai',
  desc: 'OSA và bản đầy đủ, ngưỡng tương đối, kiểm tra ≤ k lỗi theo dải chéo',
  order: 65,
  load: () => import('../EditDistanceDemo'),
} satisfies DemoRegistration;
