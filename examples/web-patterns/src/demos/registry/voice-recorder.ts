import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'voice-recorder',
  title: 'Tin nhắn thoại: ghi âm và waveform',
  desc: 'MediaRecorder + AnalyserNode, ghi tối thiểu 1 giây, waveform 100 mức đóng gói 5 bit (Telegram)',
  order: 58,
  load: () => import('../VoiceRecorderDemo'),
} satisfies DemoRegistration;
