import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'ud-sprite-thumbs',
  title: 'Udemy #4: thumbnail sprite từ WebVTT',
  desc: 'Một ảnh sprite + file VTT xywh cho thumbnail khi rê chuột trên thanh tua; chia thanh tua theo slide sao cho tổng đúng 100%',
  order: 204,
  load: () => import('../UdSpriteThumbsDemo'),
} satisfies DemoRegistration;
