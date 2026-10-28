import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'mqtt-qos1-republish',
  title: 'MQTT QoS1: giữ publish chờ ack, gửi lại khi kết nối lại',
  desc: 'Ngắt/nối kết nối, làm mất ack và xem tin được phát lại, server khử trùng theo token; heartbeat lượt xem gửi tổng tuyệt đối chịu được mất gói',
  order: 84,
  load: () => import('../Qos1Demo'),
} satisfies DemoRegistration;
