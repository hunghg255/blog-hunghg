import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'mqtt',
  title: 'MQTT trong trình duyệt',
  desc: 'Codec nhị phân, luồng fetch bị cắt giữa gói, khi nào chuyển sang long-poll',
  order: 22,
  load: () => import('../MqttDemo'),
} satisfies DemoRegistration;
