import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'tab-subdomain-lease-longpoll',
  title: 'Chia subdomain giữa các tab bằng lease, long-poll theo bảng trạng thái',
  desc: 'Mở nhiều tab mô phỏng, mỗi tab giữ một slot subdomain trong localStorage; máy trạng thái long-poll có backoff, chặn tần suất và bỏ phản hồi muộn',
  order: 83,
  load: () => import('../SubdomainLeaseDemo'),
} satisfies DemoRegistration;
