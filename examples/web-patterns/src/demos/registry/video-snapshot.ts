import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'video-snapshot',
  title: 'Chụp frame video thành ảnh',
  desc: 'Giữ tỉ lệ khung hình, canvas.toBlob thay vì toDataURL, canvas bị taint khi khác origin (Coursera, Outlook)',
  order: 59,
  load: () => import('../VideoSnapshotDemo'),
} satisfies DemoRegistration;
