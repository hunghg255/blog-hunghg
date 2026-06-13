---
title: 'Microservices Trong Production: Khi Nào Tách, Cách Tách, Tại Sao Hầu Hết Đội Làm Sai'
description: 'Hướng dẫn toàn diện về kiến trúc microservices — trade-offs thực tế, migration patterns, chiến lược giao tiếp, và sự thật phũ phàng về khi nào KHÔNG nên dùng'
date: '2026-04-26'
author: hunghg255
image: https://blog.hunghg.me/blogs/be.png
tags:
  [
    'system-design',
    'microservices',
    'monolith',
    'architecture',
    'api-gateway',
    'migration',
    'translation',
  ]
---

# Microservices Trong Production: Khi Nào Tách, Cách Tách, Tại Sao Hầu Hết Đội Làm Sai

## Hướng dẫn toàn diện về kiến trúc microservices — trade-offs thực tế, migration patterns, chiến lược giao tiếp, và sự thật phũ phàng về khi nào KHÔNG nên dùng

![Cover - Microservices in Production](https://miro.medium.com/v2/resize:fit:1100/1*3ea2VQPPdsJuiS-KeqmlFw.png)

---

## Giới Thiệu

"Chúng tôi đang tách monolith thành microservices!"

Câu nói này đã đi trước một số quyết định kiến trúc tốt nhất tôi từng chứng kiến. Nó cũng đi trước một số thất bại thảm khốc nhất.

Một startup với 5 kỹ sư đã dành 3 tháng xây dựng kiến trúc microservices.

**_Kết quả:_** Chi phí infrastructure tăng gấp ba, deploy trở thành cơn ác mộng, và vận tốc feature giảm 60%.

Họ merge tất cả trở lại thành monolith.

Một scale-up với 40 kỹ sư giữ nguyên monolith.

**_Kết quả:_** Xung đột deploy hàng ngày, các team chặn nhau, releases phải phối hợp giữa các phòng ban, vận tốc ì ạch.

- Cùng một pattern.
- Giải pháp ngược nhau.
- Cả hai đều đúng trong bối cảnh của họ.

Đây là hướng dẫn toàn diện về microservices trong production — không phải phiên bản hội thảo nơi mọi thứ hoàn hảo, mà là phiên bản thực tế với trade-offs, chi phí, và câu hỏi quan trọng: **_đội của bạn có thực sự cần điều này không?_**

**Bạn sẽ học:**

- Tại sao microservices tồn tại (vấn đề tổ chức, không phải kỹ thuật)
- Khi nào tách services (quy mô team quan trọng hơn traffic)
- Cách phân rã monolith (business capabilities, không phải technical layers)
- Service communication patterns (sync, async, hybrid)
- API Gateway implementation (cánh cửa trước của services bạn)
- Chi phí và lợi ích thực tế (infrastructure, complexity, autonomy)
- Chiến lược migration (strangler fig pattern, rủi ro thấp)

Kết thúc bài này, bạn sẽ biết liệu microservices giải quyết vấn đề thực tế của bạn hay tạo ra vấn đề mới bạn không cần.

Bắt đầu với lý do chúng tồn tại.

---

## Phần 1: Vấn Đề Monolith (Và Khi Nó Không Phải Vấn Đề)

### Monolith Là Gì?

Monolith là một ứng dụng duy nhất chứa tất cả chức năng:

```
[Single Application]
├─ User Management
├─ Product Catalog
├─ Shopping Cart
├─ Order Processing
├─ Payment
├─ Inventory
├─ Shipping
├─ Notifications
└─ Analytics
```

Tất cả module chia sẻ:

- Một codebase
- Một database
- Một deployment
- Một process

**Với team nhỏ, điều này hoàn hảo.**

### Khi Nào Monolith Hoạt Động

Team 5 kỹ sư xây dựng nền tảng e-commerce.

**Lợi ích họ trải nghiệm:**

- Đơn giản để phát triển (một codebase, dễ điều hướng)
- Nhanh để ship (một deployment, 5 phút)
- Dễ test (integration tests chạy in-process)
- Infrastructure đơn giản (3 servers, một database)
- Chi phí thấp ($200/tháng tổng cộng)

**Vận tốc của họ:**

- Ship features hàng ngày.
- Deploy 5 lần mỗi ngày.
- Không có coordination overhead.

**Tại sao nó hoạt động:**

- 5 người có thể phối hợp bằng lời nói.
- Không có độ phức tạp tổ chức.

### Khi Nào Monolith Phá Vỡ

Cùng công ty, 2 năm sau.

_Team phát triển lên 40 kỹ sư qua 8 team._

**Các vấn đề xuất hiện:**

**Vấn đề 1: Nút thắt deploy**

- Team A muốn deploy một fix analytics nhỏ.
- Team B đang giữa quá trình refactor checkout.
- Team C có feature dang dở trong codebase.

> Cuộc họp phối hợp deploy: Thứ Ba 2 PM.

- Mọi người phải sẵn sàng.
- Nếu một team chưa sẵn sàng, không ai deploy được.

**_Kết quả:_** Deploy 1 lần/tuần thay vì 5 lần/ngày.

**Vấn đề 2: Xung đột code**

- 40 kỹ sư, một codebase.
- Merge conflicts hàng ngày.
- Pull requests bị chặn bởi thay đổi của team khác.
- Code review backlog tính bằng ngày.

**Vấn đề 3: Blast radius**

- Bug nhỏ trong analytics làm sập toàn bộ ứng dụng.
- Checkout hỏng vì ai đó thay đổi shared utility function.

> **Mọi thay đổi ảnh hưởng đến tất cả mọi người.**

**Vấn đề 4: Lãng phí scaling**

- Chỉ checkout trải qua traffic spikes (giờ trưa, tối).
- Nhưng scaling có nghĩa là scaling toàn bộ ứng dụng bao gồm analytics, user management, và mọi thứ khác.
- 3 servers lúc rảnh → 12 servers lúc spike.
- Chi phí: $600/tháng → $2.400/tháng.
- **_Thực tế cần_**: Scale chỉ checkout (sẽ là $800/tháng).

**Vấn đề 5: Technology lock-in**

- Toàn bộ ứng dụng trong Python.
- Team muốn dùng Go cho payment service (hiệu suất tốt hơn, typing mạnh hơn).
- Không thể.
- Phải viết lại toàn bộ.

**Thực tế tổ chức:**

Với 40 kỹ sư, monolith trở thành nút thắt tổ chức, không phải kỹ thuật.

---

## Phần 2: Microservices — Giải Pháp Và Chi Phí Của Nó

### Microservices Là Gì?

Microservices tách monolith thành các service độc lập:

```
[API Gateway]
  ↓
├─ User Service (Node.js, Team A)
├─ Product Service (Python, Team B)
├─ Cart Service (Go, Team C)
├─ Order Service (Java, Team D)
├─ Payment Service (Go, Team E)
├─ Inventory Service (Python, Team F)
├─ Shipping Service (Ruby, Team G)
└─ Notification Service (Node.js, Team H)
```

Mỗi service có:

- Codebase riêng
- Database riêng
- Deployment riêng
- Team riêng
- Công nghệ tự chọn

### Lợi Ích (Metrics Thực Tế)

Cùng công ty 40 kỹ sư sau khi migrate lên microservices:

**Tần suất deploy:**

- Trước: 1 deploy/tuần (nút thắt phối hợp)
- Sau: 10 deploys/ngày/service (team độc lập)

**Vận tốc phát triển:**

- Trước: 2 tuần trung bình cho feature (chờ team khác)
- Sau: 3 ngày trung bình cho feature (tự chủ hoàn toàn)

**Hiệu quả scaling:**

- Trước: Scale toàn bộ app ($2.400/tháng lúc spike)
- Sau: Scale chỉ checkout service ($800/tháng lúc spike)
- Tiết kiệm: $1.600/tháng trong giờ cao điểm

**Tự chủ team:**

- Trước: Họp phối hợp, PR bị chặn, phối hợp deploy
- Sau: Teams ship độc lập, sở hữu service end-to-end

**Tự do công nghệ:**

- Trước: Mọi thứ trong Python (lock-in)
- Sau: Mỗi service chọn công cụ tốt nhất (Go cho payment, Node.js cho real-time)

**Cải thiện vận tốc:** Nhanh hơn 3 lần.

### Chi Phí (Cũng Rất Thực)

**Độ phức tạp infrastructure:**

| Tiêu chí            | Monolith | Microservices       |
| ------------------- | -------- | ------------------- |
| Application servers | 3        | 16 (8 services × 2) |
| Databases           | 1        | 8                   |
| Redis cache         | 1        | 1                   |
| Message queue       | 0        | 1                   |
| API Gateway         | 0        | 1                   |
| Monitoring servers  | 0        | 3                   |
| **Tổng servers**    | **5**    | **30**              |

**Tăng chi phí:** $600/tháng → $1.200/tháng (+100%)

**Độ phức tạp debug:**

```
Trước (Monolith):
Error in logs → Stack trace → Exact line of code
Debug time: 10 phút

Sau (Microservices):
Error reported → Which service failed?
  → Check API Gateway logs
  → Check User Service logs
  → Check Order Service logs
  → Check message queue
  → Check distributed tracing
  → Find: Network timeout between services
Debug time: 2 giờ
```

**Cần distributed tracing:**

- Tools như Jaeger, Zipkin.
- Additional infrastructure.

**Độ phức tạp test:**

```javascript
// Trước (Monolith) - một process, nhanh
test('checkout flow', async () => {
  const user = await createUser();
  const cart = await addToCart(user.id, productId);
  const order = await checkout(cart.id);
  expect(order.status).toBe('confirmed');
});
// 50ms, dễ debug

// Sau (Microservices) - 5 services, network calls
test('checkout flow', async () => {
  await startUserService();
  await startCartService();
  await startOrderService();
  await startPaymentService();
  await startInventoryService();

  const user = await userService.create();
  const cart = await cartService.add(user.id, productId);
  const order = await orderService.checkout(cart.id);
  expect(order.status).toBe('confirmed');
});
// 2 giây, flaky
```

**Độ phức tạp vận hành:**

- Trước: Một deployment pipeline, một monitoring dashboard, một log file
- Sau: 8 deployment pipelines, 8 dashboards, 8 log streams, 8 databases backup

**Yêu cầu team:**

- Trước: 2 developers có thể chạy toàn bộ stack local.
- Sau: Cần dedicated DevOps team (2–3 kỹ sư) chỉ cho infrastructure.

---

## Phần 3: Khi Nào Chọn Gì

### Quy Tắc Quy Mô Team

Đây là yếu tố quyết định quan trọng nhất:

> **< 10 Kỹ sư: Monolith**

**Tại sao:**

- Team nhỏ có thể phối hợp bằng lời nói
- Không có nút thắt tổ chức
- Chi phí độ phức tạp vượt quá lợi ích
- Không thể có dedicated DevOps team

Ví dụ: Startup giai đoạn đầu, MVP development, side project.

> **10–30 Kỹ sư: Modular Monolith**

Sự cân bằng tốt nhất:

```
[Single Deployment]
  ↓
[Well-Defined Modules]
├─ User Module
│   ├─ Clear API boundaries
│   ├─ Own database tables (users, sessions)
│   └─ Can be extracted later
│
├─ Product Module
│   ├─ Clear API boundaries
│   ├─ Own database tables (products, categories)
│   └─ Can be extracted later
│
└─ Order Module
    ├─ Clear API boundaries
    ├─ Own database tables (orders, order_items)
    └─ Can be extracted later
```

**Lợi ích:**

- Đơn giản của monolith deployment
- Kỷ luật của microservices (clear boundaries)
- Dễ dàng extract services sau
- Teams có thể sở hữu modules

**Implementation:**

```
/app
  /modules
    /users
      - routes.py
      - models.py
      - service.py
    /products
      - routes.py
      - models.py
      - service.py
    /orders
      - routes.py
      - models.py
      - service.py
```

> **30+ Kỹ sư: Microservices**

Khi độ phức tạp tổ chức biện minh cho độ phức tạp kỹ thuật:

- Nhiều teams (5–8 teams)
- Ranh giới business rõ ràng
- Nhu cầu scaling khác nhau
- Nút thắt phối hợp deploy
- Có thể đầu tư DevOps

### Ma Trận Quyết Định

**Chọn Microservices nếu TẤT CẢ đều đúng:**

- Team > 30 engineers
- Nhiều teams độc lập
- Ranh giới service rõ ràng
- Các service có nhu cầu scaling khác nhau
- Có thể có 2–3 DevOps engineers
- Có chuyên môn distributed systems
- Nút thắt phối hợp deploy là vấn đề hiện tại

**Giữ Monolith nếu BẤT KỲ đúng:**

- Team < 10 engineers
- MVP hoặc giai đoạn đầu
- Ranh giới service chưa rõ
- Ngân sách hạn chế
- Không có khả năng DevOps
- Ưu tiên deployment đơn giản

**Chọn Modular Monolith nếu:**

- Team 10–30 engineers
- Muốn lợi ích của cả hai
- Cần giữ tùy chọn mở
- Có thể tách sau

---

## Phần 4: Service Decomposition — Vẽ Ranh Giới

Nếu bạn đã quyết định tách, vẽ ranh giới ở đâu?

### Pattern 1: Phân Rã Theo Business Capability

Tách theo việc business làm, không phải cách software được cấu trúc.

**Ví dụ E-commerce:**

**Business capabilities:**

- **User Management:** Đăng ký, xác thực, profiles
- **Product Catalog:** Danh sách, tìm kiếm, categories, inventory
- **Shopping Experience:** Cart, wishlist, recommendations
- **Order Fulfillment:** Xử lý đơn hàng, theo dõi, trả hàng
- **Payment Processing:** Giao dịch, hoàn tiền, billing

Mỗi capability = một service.

**Tại sao hiệu quả:**

- Maps với ngôn ngữ business
- Product managers hiểu được
- Alignment team tự nhiên

**Ví dụ service:**

```
Order Service sở hữu:
- Tạo orders
- Trạng thái order
- Lịch sử order
- Hủy order

Dữ liệu nó sở hữu:
- orders table
- order_items table
- order_events table

Những gì nó KHÔNG sở hữu:
- User data (gọi User Service)
- Product data (gọi Product Service)
- Payment processing (gọi Payment Service)
```

### Pattern 2: Phân Rã Theo Subdomain (Domain-Driven Design)

**Xác định domains:**

**Core Domain:** Lợi thế cạnh tranh của bạn

- Product recommendations (công thức bí mật)
- Pricing algorithms (logic kinh doanh)
- Đầu tư mạnh. Giữ in-house.

**Supporting Domain:** Cần thiết nhưng không khác biệt hóa

- Order processing (quan trọng nhưng tiêu chuẩn)
- Inventory management (cần thiết)

Xây dựng nhưng đơn giản hơn.

**Generic Domain:** Chức năng hàng hóa

- Payment processing (dùng Stripe)
- Shipping (dùng FedEx/UPS APIs)
- Email delivery (dùng SendGrid)

Dùng third-party services.

### Anti-Pattern: Đừng Tách Theo Technical Layers

**SAI:**

```
[Frontend Service] ← Renders UI
  ↓
[Business Logic Service] ← All business rules
  ↓
[Data Access Service] ← Database CRUD
  ↓
[Database]
```

**Tại sao thất bại:**

- Mọi request chạm TẤT CẢ services
- Không có tính độc lập
- Thảm họa hiệu suất

Ví dụ flow:

```
User adds to cart
→ Frontend Service (render form)
→ Business Logic Service (validate)
→ Data Access Service (save)
→ Database
```

4 network calls cho operation đơn giản!

Latency cộng dồn: 10ms + 15ms + 20ms + 50ms = 95ms (vs 5ms trực tiếp)

### Strangler Fig Migration Pattern

Đừng viết lại tất cả cùng lúc. Dần dần extract services.

**Tháng 1: Extract User Service**

```
[Monolith] ← Contains everything
  ↓
[User Service] ← Newly extracted
```

Monolith route user requests đến service mới:

```python
@app.get("/users/{user_id}")
def get_user(user_id):
    return requests.get(f"http://user-service/users/{user_id}")
```

**Tháng 3: Extract Product Service**

```
[Monolith] ← Shrinking
  ↓        ↓
[User]   [Product]
```

**Tháng 6: Extract Order Service**

```
[Monolith] ← Smaller
  ↓     ↓     ↓
[User] [Product] [Order]
```

**Tháng 12: Monolith gone (hoặc tối thiểu)**

```
[API Gateway]
  ↓   ↓   ↓   ↓
[User] [Product] [Order] [Payment]
```

**Lợi ích:**

- Rủi ro thấp (từng bước)
- Học khi làm
- Có thể dừng bất kỳ lúc nào
- Team thích nghi dần
- Xác thực lợi ích trước khi cam kết hoàn toàn

---

## Phần 5: Giao Tiếp Giữa Các Services

Services cần nói chuyện với nhau.

Chọn sai pattern?

Tight coupling, cascading failures.

### Pattern 1: Synchronous (REST/HTTP)

```javascript
// Order Service cần user email
async function createOrder(userId, items) {
  const userResponse = await fetch(`http://user-service/users/${userId}`);
  const user = await userResponse.json();

  return await db.orders.create({
    userId,
    userEmail: user.email,
    items,
  });
}
```

**Ưu điểm:**

- Đơn giản để hiểu
- Phản hồi ngay lập tức
- Strong consistency
- Dễ debug (stack traces hoạt động)

**Nhược điểm:**

- Tight coupling (Order phụ thuộc User phải online)
- Cascading failures (User down = Order down)
- Độ trễ cao (network overhead)
- Blocking tài nguyên (thread chờ)

**Khi nào dùng:**

- Critical path operations (checkout, payment)
- Cần phản hồi ngay
- Dữ liệu phải current
- User-facing requests

### Pattern 2: Asynchronous (Events/Message Queue)

```javascript
// User Service - publish event
async function updateEmail(userId, newEmail) {
  await db.users.update(userId, { email: newEmail });

  await eventBus.publish('user.email.updated', {
    userId,
    newEmail,
    timestamp: Date.now(),
  });

  return { success: true };
}

// Order Service - subscribe event
eventBus.subscribe('user.email.updated', async (event) => {
  await db.orders.updateMany({ userId: event.userId }, { userEmail: event.newEmail });
  console.log(`Updated orders for user ${event.userId}`);
});
```

**Ưu điểm:**

- Loose coupling (services độc lập)
- Resilient (consumer down = messages được queue)
- Hiệu suất tốt hơn (không chờ đợi)
- Scale dễ dàng (thêm consumers)

**Nhược điểm:**

- Eventual consistency (1–5 giây delay)
- Debug phức tạp (distributed flow)
- Thách thức về thứ tự message
- Cần xử lý duplicate

**Khi nào dùng:**

- Background processing
- Nhiều consumers cần cùng dữ liệu
- Eventual consistency chấp nhận được
- Fan-out patterns

### Pattern 3: Hybrid Approach (Tốt Nhất Trong Thực Tế)

Kết hợp cả hai dựa trên yêu cầu:

```javascript
// Checkout flow - synchronous cho critical path
async function checkout(cartId, userId) {
  // SYNCHRONOUS (critical path)
  // Phải thành công, phải tức thì
  const inventory = await inventoryService.reserve(cartId); // Wait
  const payment = await paymentService.charge(userId); // Wait

  if (!payment.success) {
    await inventoryService.release(cartId);
    throw new PaymentError();
  }

  const order = await createOrder({
    cartId,
    userId,
    paymentId: payment.id,
  });

  // ASYNCHRONOUS (non-critical)
  // Fire and forget, xử lý trong background
  await eventBus.publish('order.created', {
    orderId: order.id,
    userId,
    items: order.items,
  });

  return order; // Return immediately
}

// Background consumers (async)
eventBus.subscribe('order.created', async (event) => {
  await sendConfirmationEmail(event);
  await trackPurchase(event);
  await createPickingList(event);
});
```

Critical path nhanh (200ms). Non-critical tasks xảy ra bất đồng bộ.

---

## Phần 6: API Gateway — Cánh Cửa Trước

API Gateway nằm giữa clients và services.

### Tại Sao Cần API Gateway?

**Không có Gateway:**

```javascript
// Mobile app cần user profile - 3 network calls
const user = await fetch('http://user-service/users/123');
const orders = await fetch('http://order-service/orders?userId=123');
const payments = await fetch('http://payment-service/methods?userId=123');
```

**Có Gateway:**

```javascript
// Mobile app - 1 network call
const profile = await fetch('https://api.example.com/profile/123');
```

### Trách Nhiệm Của Gateway

**1. Authentication**

Xác thực một lần tại gateway:

```javascript
async function authenticate(req, res, next) {
  const token = req.headers.authorization;
  try {
    const user = await verifyJWT(token);
    req.user = user;
    req.headers['X-User-Id'] = user.id;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Unauthorized' });
  }
}
```

Services không xử lý auth. Họ trust gateway.

**2. Rate Limiting**

Ngăn chặn abuse tập trung:

```javascript
const rateLimiter = new RateLimiter({
  points: 100, // 100 requests
  duration: 60, // per 60 seconds
});

async function rateLimit(req, res, next) {
  const userId = req.user.id;
  try {
    await rateLimiter.consume(userId);
    next();
  } catch {
    res.status(429).json({
      error: 'Rate limit exceeded',
      retryAfter: 60,
    });
  }
}
```

**3. Request Aggregation**

Kết hợp nhiều service calls:

```javascript
app.get('/profile/:userId', async (req, res) => {
  const { userId } = req.params;

  const [user, orders, payments] = await Promise.all([
    fetch(`http://user-service/users/${userId}`),
    fetch(`http://order-service/orders?userId=${userId}`),
    fetch(`http://payment-service/methods?userId=${userId}`),
  ]);

  res.json({
    user: await user.json(),
    recentOrders: await orders.json(),
    paymentMethods: await payments.json(),
  });
});
```

Client gọi 1 lần. Gateway gọi 3 lần (nhanh hơn, internal network).

**4. Circuit Breaking**

Bảo vệ khỏi cascading failures:

```javascript
const CircuitBreaker = require('opossum');

const userServiceBreaker = new CircuitBreaker(
  async (userId) => {
    return await fetch(`http://user-service/users/${userId}`);
  },
  {
    timeout: 3000, // 3 giây timeout
    errorThresholdPercentage: 50, // 50% lỗi = mở circuit
    resetTimeout: 30000, // Thử lại sau 30 giây
  },
);

app.get('/users/:id', async (req, res) => {
  try {
    const user = await userServiceBreaker.fire(req.params.id);
    res.json(user);
  } catch (error) {
    // Fallback - trả về cached data
    res.json(getCachedUser(req.params.id));
  }
});
```

Khi User Service thất bại liên tục:

- Circuit mở (ngừng gọi service đang lỗi)
- Trả về cached/fallback data
- Thử lại sau 30 giây
- Tự động phục hồi

### Cấu Hình Gateway Production

```nginx
upstream user_service {
    least_conn;
    server user-service-1:8001;
    server user-service-2:8001;
}

upstream order_service {
    least_conn;
    server order-service-1:8002;
    server order-service-2:8002;
}

server {
    listen 443 ssl;
    server_name api.example.com;

    ssl_certificate /etc/ssl/api.crt;
    ssl_certificate_key /etc/ssl/api.key;

    limit_req_zone $http_x_user_id zone=user_limit:10m rate=100r/m;

    location /api/users {
        limit_req zone=user_limit burst=20;
        proxy_pass http://user_service;
        proxy_set_header X-User-Id $http_x_user_id;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_connect_timeout 3s;
        proxy_read_timeout 10s;
    }

    location /api/orders {
        limit_req zone=user_limit burst=20;
        proxy_pass http://order_service;
        proxy_set_header X-User-Id $http_x_user_id;
    }
}
```

---

## Phần 7: Thách Thức Về Data Consistency

Microservices có database riêng biệt. Làm thế nào để giữ dữ liệu nhất quán?

### Vấn Đề

Monolith transaction (ACID):

```sql
BEGIN TRANSACTION;
    INSERT INTO orders (user_id, total) VALUES (123, 99.99);
    UPDATE inventory SET quantity = quantity - 1 WHERE product_id = 456;
    INSERT INTO payments (order_id, amount) VALUES (789, 99.99);
COMMIT;
```

- Tất cả hoặc không có gì.
- Atomic.
- Dễ dàng.

Microservices (database riêng biệt):

```
Order Service DB: orders table
Inventory Service DB: inventory table
Payment Service DB: payments table
```

Không thể dùng database transaction xuyên services!

### Giải Pháp: Saga Pattern

Saga = chuỗi các local transactions với các compensating actions.

**Ví dụ: Order creation saga**

```javascript
// Bước 1: Order Service
const order = await db.orders.create({
  userId: 123,
  items: [{ productId: 456, quantity: 1 }],
  total: 99.99,
  status: 'pending',
});
await events.publish('order.created', { orderId: order.id });

// Bước 2: Inventory Service
events.on('order.created', async (event) => {
  try {
    await db.inventory.update({
      productId: 456,
      quantity: db.raw('quantity - 1'),
    });
    await events.publish('inventory.reserved', {
      orderId: event.orderId,
    });
  } catch (error) {
    await events.publish('inventory.failed', {
      orderId: event.orderId,
      reason: 'Out of stock',
    });
  }
});

// Bước 3: Payment Service
events.on('inventory.reserved', async (event) => {
  try {
    const payment = await stripeAPI.charge({
      orderId: event.orderId,
      amount: 99.99,
    });
    await events.publish('payment.completed', {
      orderId: event.orderId,
      paymentId: payment.id,
    });
  } catch (error) {
    await events.publish('payment.failed', {
      orderId: event.orderId,
    });
  }
});

// Bước 4: Xử lý thành công
events.on('payment.completed', async (event) => {
  await db.orders.update(event.orderId, {
    status: 'confirmed',
  });
});

// Bước 5: Xử lý thất bại (Compensating Transactions)
events.on('inventory.failed', async (event) => {
  await db.orders.update(event.orderId, {
    status: 'cancelled',
    cancellationReason: event.reason,
  });
});

events.on('payment.failed', async (event) => {
  // Hoàn lại inventory
  await events.publish('inventory.release', {
    orderId: event.orderId,
  });
  await db.orders.update(event.orderId, {
    status: 'cancelled',
    cancellationReason: 'Payment failed',
  });
});

events.on('inventory.release', async (event) => {
  await db.inventory.update({
    productId: 456,
    quantity: db.raw('quantity + 1'), // Hoàn lại
  });
});
```

**Kết quả:**

- Eventual consistency (2–5 giây)
- Mỗi service tự chủ
- Failures được xử lý gracefully
- Compensating transactions để rollback

**Trade-off:**

- Không phải ACID.
- Nhưng services vẫn độc lập.

---

## Phần 8: Câu Chuyện Migration Có Thật

### Bối Cảnh

- SaaS platform.
- 15 kỹ sư.
- Ứng dụng Rails monolith.
- Phát triển lên 40 kỹ sư.

**Nỗi đau:**

- Phối hợp deploy (họp release hàng tuần)
- Merge conflicts hàng ngày
- Không thể scale checkout độc lập
- Teams bị chặn bởi nhau

**Quyết định:** Migrate lên microservices.

### Phase 1: Lên Kế Hoạch (2 tuần)

Xác định services:

1. User Service (authentication, profiles)
2. Product Service (catalog, search)
3. Order Service (checkout, order management)
4. Payment Service (transactions, billing)
5. Notification Service (email, SMS)

**Phân bổ team:**

- 8 teams × 5 engineers
- Mỗi team sở hữu 1–2 services

### Phase 2: Infrastructure (4 tuần)

**Setup:**

- Kubernetes cluster
- API Gateway (Kong)
- Message queue (RabbitMQ)
- Monitoring (Prometheus + Grafana)
- Distributed tracing (Jaeger)
- CI/CD pipelines mỗi service

**Chi phí:** 1 dedicated DevOps engineer full-time trong 4 tuần.

### Phase 3: Extract Service Đầu Tiên (6 tuần)

**Tuần 1–2:** Extract User Service

- Copy user module code
- Setup database mới
- Deploy cùng với monolith
- Route 1% traffic đến service mới

**Tuần 3–4:** Validate

- Monitor error rates
- So sánh responses (monolith vs service)
- Fix discrepancies

**Tuần 5–6:** Tăng traffic

- 1% → 10% → 50% → 100%
- Xóa user module khỏi monolith

**Kết quả:**

- Service đầu tiên được extract.
- Team học được migration pattern.

### Phase 4: Extract Các Service Còn Lại (6 tháng)

Một service mỗi 4–6 tuần:

- Tháng 1–2: User Service
- Tháng 3: Product Service
- Tháng 4–5: Order Service
- Tháng 6: Payment Service
- Tháng 7: Notification Service

**Trạng thái cuối:** 5 microservices + monolith nhỏ (admin panel).

### Kết Quả

| Tiêu chí               | Trước (Monolith) | Sau (Microservices)          |
| ---------------------- | ---------------- | ---------------------------- |
| Tần suất deploy        | 1/tuần           | 8 deploys/ngày/service       |
| Lead time              | 2 tuần           | 3 ngày                       |
| Chi phí infrastructure | $600/tháng       | $1.200/tháng (+100%)         |
| Xung đột team          | Hàng ngày        | Không (team độc lập)         |
| Scaling                | Toàn bộ app      | Theo service (tiết kiệm 60%) |

**Happiness survey:** Cải thiện từ 6/10 lên 8.5/10.

**Trade-offs được chấp nhận:**

- 2x chi phí infrastructure (đáng giá cho vận tốc team)
- Độ phức tạp (quản lý được với tooling tốt)
- DevOps investment (2 dedicated engineers)

**Có đáng không?**

- Với 40 kỹ sư, hoàn toàn xứng đáng.
- Với 15 kỹ sư? Sẽ đợi.

---

## Phần 9: Những Sai Lầm Thường Gặp Và Cách Tránh

### Sai Lầm 1: Microservices Quá Sớm

**Chuyện gì đã xảy ra:**

Startup 5 người xây dựng 8 microservices từ ngày đầu.

**Kết quả:**

- 60% thời gian engineering cho infrastructure
- 40% cho features
- Đốt $50K trên AWS (over-engineered)
- Ship 3 features trong 3 tháng (đáng lẽ 15)

**Fix:** Merge lại thành monolith. Ship 12 features tháng sau.

**Bài học:** Đừng giải quyết vấn đề tương lai. Giải quyết vấn đề hiện tại.

### Sai Lầm 2: Shared Database

**Chuyện gì đã xảy ra:**

Tách thành 5 services nhưng giữ shared database:

```
[User Service] ────┐
[Order Service] ───┼──→ [Shared Database]
[Product Service] ─┘
```

**Vấn đề:**

- Schema changes ảnh hưởng tất cả services
- Không thể scale databases độc lập
- Tight coupling qua database
- Mất tính độc lập

**Fix:** Database per service:

```
[User Service] → [Users DB]
[Order Service] → [Orders DB]
[Product Service] → [Products DB]
```

Giao tiếp qua APIs, không phải truy cập database trực tiếp.

### Sai Lầm 3: Nano-Services

**Chuyện gì đã xảy ra:**

Tách thành 50 services. Mỗi service có 1–2 endpoints.

Ví dụ:

- GetUserName Service
- GetUserEmail Service
- GetUserAddress Service

**Kết quả:**

- Network overhead giết chết hiệu suất
- 50 deployment pipelines để quản lý
- Debugging nightmare (trace qua 10 services)

**Fix:** Gộp lại thành 8 services. Mỗi service 5–10 endpoints.

**Quy tắc:**

- Service nên được sở hữu bởi 2–3 engineers
- Có thể viết lại trong 1–2 tuần

### Sai Lầm 4: Synchronous Chains

**Chuyện gì đã xảy ra:**

Mọi service gọi service tiếp theo đồng bộ:

```
Gateway → User Service → Order Service → Product Service → Inventory Service
```

Latency: 50ms + 50ms + 50ms + 50ms = 200ms (best case)

Nếu một service chậm (500ms)? Tổng: 700ms.

**Fix:** Hybrid approach. Critical path synchronous. Others asynchronous.

### Sai Lầm 5: Không API Versioning

**Chuyện gì đã xảy ra:**

Đổi format response API trong User Service.

Tất cả consuming services bị hỏng.

**Trước:** `{ "userId": "123", "name": "John" }`

**Sau (breaking change):** `{ "user": { "id": "123", "fullName": "John Doe" } }`

**Fix:** Version APIs từ ngày đầu:

```
GET /v1/users/123  (format cũ - vẫn hoạt động)
GET /v2/users/123  (format mới)
```

Gradual migration. Không breaking changes.

---

## Tổng Kết

### Hành Trình Từ Monolith Đến Microservices

- **Bắt đầu với:** Tại sao microservices tồn tại (vấn đề tổ chức)
- **Học được:** Khi nào dùng (team size > 30)
- **Khám phá:** Cách tách (business capabilities, strangler fig)
- **Triển khai:** Communication patterns (sync, async, hybrid)
- **Xây dựng:** API Gateway (routing, auth, aggregation)
- **Giải quyết:** Data consistency (saga pattern)

### Sự Thật Phũ Phàng

Microservices **không phải** là:

- Best practice
- Luôn luôn tốt hơn
- Cách "hiện đại"
- Dành cho mọi công ty

Microservices **là**:

- Một sự đánh đổi
- Complexity để đổi lấy scale
- Đáng giá ở quy mô phù hợp (30+ engineers)
- Overkill cho team nhỏ

### Bài Học Chính

1. **Quy mô team quyết định kiến trúc** — Không phải traffic, không phải scale, mà là tổ chức team
2. **Bắt đầu với monolith, tách khi cần** — Đừng over-engineer
3. **Modular monolith bị đánh giá thấp** — Tốt nhất của cả hai thế giới cho 10–30 engineers
4. **Communication pattern quan trọng** — Sync cho critical path, async cho background
5. **Chấp nhận eventual consistency** — Không thể có ACID xuyên services
6. **Đầu tư vào tooling** — Monitoring, tracing, deployment automation là thiết yếu
7. **Gradual migration thắng** — Strangler fig pattern, rủi ro thấp

### Framework Quyết Định

**Hãy tự hỏi:**

- Team tôi có > 30 engineers? (Nếu không, hãy giữ monolith)
- Deploy conflicts có đang chặn chúng tôi? (Nút thắt tổ chức?)
- Các phần khác nhau có cần scaling khác nhau? (Nhu cầu kỹ thuật?)
- Chúng tôi có thể có 2–3 DevOps engineers? (Yêu cầu tài nguyên?)
- Chúng tôi có chuyên môn distributed systems? (Kiểm tra năng lực?)

**Nếu tất cả đều có:** Cân nhắc microservices.

**Nếu bất kỳ không có:** Giữ monolith hoặc modular monolith.
