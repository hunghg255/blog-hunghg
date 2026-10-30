---
title: 'Modular Monolith vs Microservices: Chọn Kiến Trúc Nào Cho Đội Của Bạn?'
description: 'So sánh modular monolith và microservices dưới góc nhìn thực tế: cách giữ ranh giới module, deploy, scale, quy mô team, tính nhất quán dữ liệu, chi phí vận hành, debug, khi nào chọn cái nào và cách tách dần sang microservices với ví dụ TypeScript/Node'
date: '2026-10-23'
series: system-design
seriesOrder: 8
author: hunghg255
image: https://blog.hunghg.me/blogs/modular-monolith.png
tags: ['architecture', 'microservices', 'monolith', 'backend', 'nodejs', 'typescript', 'system-design']
---

# Modular Monolith vs Microservices: Chọn Kiến Trúc Nào Cho Đội Của Bạn?

## **Vấn đề thường không nằm ở "một khối hay nhiều mảnh", mà ở chỗ ranh giới giữa các phần có rõ ràng hay không**

---

Có một kịch bản rất quen: startup 5 dev, sản phẩm chưa có product-market fit, nhưng hệ thống đã có 12 service, 3 message queue, một cụm Kubernetes và một người gần như full-time chỉ để giữ pipeline CI/CD không đỏ. Mỗi lần sửa một tính năng phải đụng 4 repo và deploy theo đúng thứ tự.

Kịch bản ngược lại cũng quen không kém: một codebase "monolith" 8 năm tuổi, nơi file `utils.ts` được import ở 600 chỗ, module thanh toán query thẳng vào bảng của module kho, và không ai dám đụng vào thứ gì.

Cả hai đều là thất bại về **ranh giới**, chỉ là ở hai thái cực. Bài này nói về **modular monolith** — con đường ở giữa — và khi nào thì nên bước tiếp sang **microservices**.

---

## 1. Định nghĩa nhanh

**Monolith truyền thống**: một ứng dụng, một lần deploy, và *không có ranh giới thật sự bên trong*. Code ở đâu cũng gọi được code ở chỗ khác.

**Modular monolith**: vẫn là **một ứng dụng, một lần deploy, một process**, nhưng bên trong được chia thành các **module theo nghiệp vụ** (đơn hàng, thanh toán, kho, người dùng…). Mỗi module:

- sở hữu dữ liệu của riêng nó,
- chỉ lộ ra một **public API** nhỏ (hàm, interface, event),
- giấu toàn bộ phần còn lại.

**Microservices**: mỗi năng lực nghiệp vụ là một **service deploy độc lập**, thường có database riêng, giao tiếp qua mạng (HTTP, gRPC, message broker).

Điểm mấu chốt: cả modular monolith lẫn microservices đều theo đuổi **ranh giới rõ ràng theo nghiệp vụ**. Khác biệt là *thứ gì giữ ranh giới đó*:

- Modular monolith: **tooling và kỷ luật** (lint, build, review).
- Microservices: **mạng** — bạn không thể import class của service khác, vì nó nằm ở máy khác.

Mạng là một hàng rào rất chắc, nhưng cũng rất đắt.

---

## 2. Modular monolith giữ ranh giới bằng cách nào?

"Chia thư mục cho đẹp" thì chưa phải modular monolith. Ranh giới chỉ có giá trị khi **vi phạm sẽ làm build fail**. Vài cách phổ biến trong hệ sinh thái TypeScript/Node:

1. **Một điểm vào công khai cho mỗi module.** Mỗi module có `index.ts` export đúng những gì được phép dùng. Module khác chỉ được import từ đó, không được đi sâu vào `internal/`.
2. **Lint rule cho import.** `no-restricted-imports` của ESLint, `eslint-plugin-boundaries`, hoặc `dependency-cruiser` có thể cấm import xuyên ranh giới và cấm phụ thuộc vòng.
3. **Workspace/monorepo package.** Biến mỗi module thành một package (pnpm/npm workspaces) với trường `exports` trong `package.json` — Node sẽ chặn import vào file không được export. Nếu dùng Nx, rule `@nx/enforce-module-boundaries` cho phép gắn tag và quy định module nào được phụ thuộc vào module nào.
4. **Sở hữu dữ liệu.** Mỗi module có schema/bảng riêng (ví dụ schema Postgres `orders`, `billing`). Module khác không JOIN hay query thẳng vào đó — muốn dữ liệu thì gọi public API.
5. **Giao tiếp bằng event khi có thể.** Thay vì `orders` gọi trực tiếp `billing`, `orders` phát event `OrderPlaced`; ai quan tâm thì lắng nghe. Phụ thuộc chỉ còn một chiều.

Ở hệ sinh thái khác cũng có công cụ tương tự: **Packwerk** (Ruby, do Shopify viết), **ArchUnit** (Java), **Spring Modulith** (Spring Boot).

> Ví dụ thực tế: Shopify — một trong những codebase Rails lớn nhất thế giới — đã chủ động chọn tiến hóa từ monolith lên **modular monolith** thay vì tách microservices, và viết Packwerk để kiểm tra tĩnh hai loại vi phạm: phụ thuộc vào package chưa khai báo, và truy cập phần private của package khác. Công cụ này chạy trong CI của họ.

---

## 3. Ưu và nhược điểm, theo từng tiêu chí

### Deploy
- **Modular monolith**: một artifact, một pipeline. Release và rollback đơn giản. Nhưng mọi thay đổi — dù chỉ sửa một dòng ở module nhỏ — đều deploy lại cả ứng dụng, và các team phải chia nhau "chuyến xe" release.
- **Microservices**: mỗi team release theo nhịp riêng. Đổi lại là N pipeline, N phiên bản đang chạy cùng lúc, và phải quản lý tương thích API giữa chúng.

### Scale
- **Modular monolith**: scale theo chiều ngang cả khối. Nếu chỉ module tìm kiếm ngốn CPU, bạn vẫn phải nhân bản cả ứng dụng. Thường thì vẫn ổn — một instance thừa vài module ít dùng không tốn bao nhiêu.
- **Microservices**: scale đúng chỗ cần. Rất đáng giá khi các phần trong hệ thống có tải chênh lệch lớn hoặc yêu cầu tài nguyên khác hẳn nhau (ví dụ xử lý video cần GPU).

### Quy mô team
- **Modular monolith**: rất hợp với một team hoặc vài team làm việc sát nhau.
- **Microservices**: phát huy khi có **nhiều team tự chủ**, mỗi team sở hữu trọn một service. Đây chính là **định luật Conway** (Melvin Conway, 1968): cấu trúc hệ thống có xu hướng phản chiếu cấu trúc giao tiếp của tổ chức tạo ra nó. Có ít team mà nhiều service thì mỗi người phải ôm nhiều service, và lợi ích "tự chủ" biến mất.

### Tính nhất quán dữ liệu
- **Modular monolith**: thường dùng chung một database, nên khi thật sự cần, một transaction ACID có thể bao trọn thao tác của nhiều module.
- **Microservices**: database riêng cho mỗi service nghĩa là **không còn transaction xuyên service**. Bạn phải làm quen với eventual consistency, saga, transactional outbox, xử lý message trùng lặp (idempotency).

### Chi phí vận hành
- **Modular monolith**: ít hạ tầng, ít công cụ, ít thứ phải trực on-call.
- **Microservices**: cần service discovery, API gateway, centralized logging, metrics, distributed tracing, quản lý secret và config cho từng service… Đây là chi phí cố định, trả từ ngày đầu tiên.

### Độ trễ
- **Modular monolith**: gọi giữa các module là gọi hàm trong cùng process — tính bằng nano đến micro giây.
- **Microservices**: mỗi lần gọi là một round-trip mạng, cộng serialize/deserialize. Một request đi qua chuỗi 5 service sẽ cộng dồn độ trễ và xác suất lỗi của cả 5.

### Debug
- **Modular monolith**: một stack trace, đặt breakpoint chạy xuyên các module, chạy cả hệ thống trên laptop.
- **Microservices**: lỗi có thể nằm ở timeout, retry, message đến hai lần hoặc không bao giờ đến. Không có distributed tracing (ví dụ OpenTelemetry) thì gần như đi tìm kim đáy bể.

---

## 4. Bảng so sánh

| Tiêu chí | Modular monolith | Microservices |
| --- | --- | --- |
| Đơn vị deploy | 1 | Nhiều, độc lập |
| Ranh giới được giữ bởi | Lint/build/review | Mạng |
| Giao tiếp | Gọi hàm, event in-process | HTTP/gRPC/message broker |
| Scale | Cả ứng dụng | Từng service |
| Transaction | ACID xuyên module (khi cần) | Saga, eventual consistency |
| Độ trễ nội bộ | Rất thấp | Cộng thêm độ trễ mạng mỗi hop |
| Debug | Một process, một stack trace | Cần distributed tracing |
| Chi phí vận hành | Thấp | Cao, tăng theo số service |
| Tự chủ của team | Vừa phải | Cao |
| Đa ngôn ngữ/stack | Khó | Dễ |
| Cô lập lỗi | Một module lỗi có thể kéo sập cả process | Lỗi gói gọn hơn (nếu thiết kế tốt) |
| Hợp với | Team nhỏ–vừa, domain còn thay đổi | Nhiều team, domain ổn định, tải không đều |

---

## 5. Khi nào chọn cái nào?

**Nghiêng về modular monolith khi:**
- Sản phẩm còn mới, domain chưa rõ, ranh giới còn đổi liên tục. Dời ranh giới trong một codebase là một lần refactor; dời ranh giới giữa các service là một dự án migrate dữ liệu.
- Team nhỏ, chưa có nền tảng DevOps/observability vững.
- Nghiệp vụ cần nhất quán mạnh (tài chính, tồn kho…).

**Nghiêng về microservices khi:**
- Có nhiều team cần release độc lập, thường xuyên, và đang giẫm chân nhau trong cùng một codebase.
- Một vài phần có yêu cầu scale, độ sẵn sàng hoặc công nghệ khác hẳn phần còn lại.
- Ranh giới domain đã ổn định qua thời gian.
- Tổ chức đã có CI/CD tự động, monitoring, tracing và văn hóa on-call trưởng thành.

Martin Fowler gọi hướng tiếp cận này là **"Monolith First"** (bài viết năm 2015): ông quan sát rằng phần lớn câu chuyện microservices thành công bắt đầu từ một monolith rồi mới tách ra, vì ranh giới đúng chỉ lộ rõ khi hệ thống đã chạy thật.

Và chiều ngược lại cũng xảy ra. Năm 2023, đội Prime Video của Amazon chia sẻ rằng công cụ giám sát chất lượng audio/video của họ, ban đầu dựng bằng các thành phần serverless phân tán (Step Functions, Lambda, S3 làm nơi trung chuyển), chạm giới hạn scale ở khoảng 5% tải dự kiến. Gom các thành phần vào **một process** giúp giảm **hơn 90% chi phí hạ tầng** và tăng khả năng scale. Chính tác giả cũng nhấn mạnh quyết định này phải xét theo từng trường hợp — đây không phải lời tuyên bố "microservices đã chết", mà là lời nhắc rằng ranh giới qua mạng có giá của nó.

---

## 6. Ví dụ cấu trúc thư mục TypeScript/Node

Một modular monolith cho hệ thống bán hàng nhỏ:

```text
src/
├── main.ts                     # bootstrap: tạo app, đăng ký các module
├── shared/
│   ├── event-bus.ts            # event bus in-process
│   └── db.ts                   # kết nối DB dùng chung (mỗi module một schema)
└── modules/
    ├── catalog/
    │   ├── index.ts            # ⬅ public API duy nhất của module
    │   ├── catalog.routes.ts
    │   └── internal/
    │       ├── product.repo.ts
    │       └── pricing.ts
    ├── ordering/
    │   ├── index.ts
    │   ├── events.ts           # định nghĩa event mà module phát ra
    │   ├── ordering.routes.ts
    │   └── internal/
    │       ├── order.entity.ts
    │       ├── order.repo.ts
    │       └── place-order.ts
    └── invoicing/
        ├── index.ts
        └── internal/
            ├── on-order-placed.ts
            └── invoice.repo.ts
```

Event bus đơn giản, có kiểu:

```ts
// src/shared/event-bus.ts
type Handler<T> = (payload: T) => Promise<void> | void;

export class EventBus<Events extends Record<string, unknown>> {
  private handlers = new Map<keyof Events, Handler<any>[]>();

  on<K extends keyof Events>(name: K, handler: Handler<Events[K]>) {
    const list = this.handlers.get(name) ?? [];
    this.handlers.set(name, [...list, handler]);
  }

  async emit<K extends keyof Events>(name: K, payload: Events[K]) {
    for (const handler of this.handlers.get(name) ?? []) {
      await handler(payload);
    }
  }
}
```

Module `ordering` chỉ lộ ra đúng những gì người khác cần:

```ts
// src/modules/ordering/events.ts
export interface OrderingEvents {
  'ordering.order-placed': { orderId: string; customerId: string; amountCents: number };
}

// src/modules/ordering/index.ts
export type { OrderingEvents } from './events';
export { registerOrdering } from './ordering.routes';
export { getOrderSummary } from './internal/place-order'; // query công khai, trả DTO chứ không trả entity
```

Module `invoicing` phản ứng với event mà không cần biết bên trong `ordering` có gì:

```ts
// src/modules/invoicing/internal/on-order-placed.ts
import type { OrderingEvents } from '../../ordering'; // chỉ import từ public API
import { invoiceRepo } from './invoice.repo';

export async function onOrderPlaced(e: OrderingEvents['ordering.order-placed']) {
  await invoiceRepo.create({ orderId: e.orderId, customerId: e.customerId, totalCents: e.amountCents });
}
```

Và một rule ESLint để biến quy ước thành luật:

```js
// eslint.config.js (trích)
export default [
  {
    files: ['src/modules/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/modules/*/internal/**', '!./internal/**'],
              message: 'Chỉ được import module khác qua index.ts (public API).',
            },
          ],
        },
      ],
    },
  },
];
```

> Pattern trên là phiên bản tối giản. Với dự án thật, `eslint-plugin-boundaries` hoặc `dependency-cruiser` cho phép khai báo rõ "module A được phụ thuộc vào B, không được vào C" và bắt cả phụ thuộc vòng.

---

## 7. Tách dần sang microservices (không viết lại từ đầu)

Nếu ranh giới module đã sạch, tách một module thành service là việc có kiểm soát. Quy trình mình hay dùng:

1. **Có lý do cụ thể.** "Module invoicing cần scale riêng vì job xuất PDF ngốn CPU" là lý do. "Microservices nghe hiện đại" thì không.
2. **Kiểm tra ranh giới.** Module có tự sở hữu dữ liệu chưa? Có ai còn JOIN vào bảng của nó? Có import nào vượt qua `index.ts`? Sửa hết trước khi tách.
3. **Đổi cơ chế vận chuyển, giữ nguyên hợp đồng.** Event `ordering.order-placed` vẫn giữ nguyên shape, chỉ thay event bus in-process bằng message broker. Để không mất message khi crash giữa "lưu đơn" và "phát event", dùng **transactional outbox**: ghi event vào bảng outbox trong cùng transaction với đơn hàng, một worker sẽ đẩy nó lên broker.
4. **Làm consumer idempotent.** Message có thể đến hai lần; xử lý lại không được tạo hai hóa đơn (ví dụ: unique constraint trên `orderId`).
5. **Tách dữ liệu.** Chuyển schema `invoicing` sang database riêng của service mới.
6. **Chuyển traffic dần dần** (theo kiểu **strangler fig**): bật feature flag, chạy song song, so sánh kết quả, giữ đường rollback.
7. **Bổ sung observability trước khi cần nó**: log có correlation ID, metrics, tracing xuyên service.

Lặp lại *chỉ khi* có nhu cầu thật cho lần tách tiếp theo. Rất nhiều hệ thống dừng ở trạng thái "một modular monolith lớn + vài service vệ tinh" và chạy rất ổn.

---

## 8. Những cái bẫy hay gặp

- **Distributed monolith**: các service phải deploy cùng nhau, gọi nhau đồng bộ thành chuỗi dài, dùng chung database. Bạn trả đủ chi phí của microservices mà không nhận được lợi ích nào.
- **Tách quá sớm**: ranh giới sai giữa các service rất đắt để sửa.
- **Modular monolith chỉ trên giấy**: có thư mục `modules/` nhưng không có rule nào chặn import tắt — sau vài deadline sẽ lại thành "big ball of mud".
- **Module chung "shared" phình to**: `shared/` chỉ nên chứa hạ tầng kỹ thuật (logger, event bus, db client), không chứa logic nghiệp vụ.
- **Bỏ qua observability** khi đã lên microservices.

---

## Tổng kết

Modular monolith và microservices không phải hai phe đối địch, mà là **hai điểm trên cùng một con đường**. Modular monolith cho bạn tốc độ, sự đơn giản và chi phí thấp, miễn là bạn đủ kỷ luật để giữ ranh giới. Microservices cho bạn khả năng deploy và scale độc lập, đổi lại là toàn bộ độ phức tạp của hệ phân tán.

Lời khuyên thực dụng: **bắt đầu bằng modular monolith, dùng tooling để giữ ranh giới, và chỉ tách service khi có một vấn đề thật mà kiến trúc hiện tại không giải được.** Khi đó, nhờ ranh giới đã sạch, việc tách sẽ là một bước đi có kế hoạch chứ không phải một cuộc đại phẫu.
