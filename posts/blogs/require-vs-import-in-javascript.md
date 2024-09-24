---
title: Tìm hiểu về require và import trong javascript
authors: hunghg255
tags: [js, import, require]
image: https://blog.hunghg.me/blogs/require-import.jpg
date: '2024-09-24'
---

Tìm hiểu về Require và Import trong JavaScript: Tìm hiểu nhanh

Tôi nhớ khi bắt đầu viết code, tôi thấy một số tệp js sử dụng `require()` để import modules và các tệp khác bằng `import`. Điều này luôn khiến tôi bối rối vì tôi không thực sự hiểu sự khác biệt là gì hoặc tại sao lại có sự không nhất quán giữa các dự án. Nếu bạn đang thắc mắc điều tương tự, hãy tiếp tục đọc!

<!--truncate-->

## CommonJS là gì?

CommonJS là một trong những tiêu chuẩn được sử dụng để triển khai các modules trong server-side JavaScript, chủ yếu là môi trường Node.js. Trong hệ thống này, các modules được tải đồng bộ, có nghĩa là việc thực thi tập lệnh bị chặn cho đến khi modules được tải. Điều này tạo ra một cách tiếp cận đơn giản, nhưng nhược điểm là ảnh hưởng đến hiệu suất nếu bạn đang cố tải nhiều modules khác nhau vì chúng phải tải lần lượt trước khi bất kỳ modules nào khác có thể chạy.

Khi sử dụng CommonJS, bạn sẽ sử dụng `module.exports` để export functions và sử dụng require() để import nó

Đây là một ví dụ:

```js
// In file multiple.js

module.exports = function multiply(x, y) {
  return x * y;
};
```

```js
// In file main.js

const multiply = require(‘./multiply.js’);

console.log(multiply(5, 4)); // Output: 20
```

## EMACScript ES6 là gì?

ES6, còn được gọi là ECMAScript, là phiên bản JavaScript mới hơn được phát hành vào năm 2015. Bản phát hành này có khả năng import modules không đồng bộ bằng cách sử dụng câu lệnh `import` và `export`. Điều này có nghĩa là tập lệnh bạn đang chạy có thể tiếp tục thực thi trong khi modules đang được tải vào nên không không phải đợi modules trước đó được tải. Điều này cũng cho phép đạt được hiệu quả gọi là Tree shaking mà tôi sẽ đề cập trong bài sau, nhưng về cơ bản, điều này có nghĩa là bạn chỉ tải JavaScript từ modules bạn đang sử dụng và mã chết (mã không được sử dụng) không được tải vào trình duyệt. Điều này hoàn toàn có thể thực hiện được vì ES6 hỗ trợ cả static import và dynamic import.

Đây là ví dụ tương tự:

```js
// In file multiply.js

export const multiply = (x, y) => x * y;
```

```js
// In file main.js

import { multiply } from ‘./multiply.js’;

console.log(multiply(5, 4)); // Output: 20
```

## Điểm khác biệt giữa require và import

`require()` là một phần của hệ thống CommonJS module trong khi import là một phần của hệ thống ES6 module. Bạn sẽ thấy `require()` được sử dụng trong môi trường server-side môi trường Node.js, chủ yếu trên các dự án cũ chưa áp dụng ES6. Bạn sẽ thấy `import` được sử dụng trong cả server-side và client-side, đặc biệt là các dự án mới hơn và với bất kỳ library hay framework nào như React hoặc Vue.

## Tại sao import tốt hơn require?

Như chúng tôi đã đề cập trước đó, quá trình import không đồng bộ, có thể dẫn đến hiệu suất tốt hơn, đặc biệt là trong các ứng dụng lớn. Ngoài ra, vì quá trình import có thể được statically analyzed nên các công cụ như linters và bundlers có thể tối ưu hóa mã hiệu quả hơn và thực hiện tree shaking, dẫn đến kích thước gói nhỏ hơn và thời gian tải nhanh hơn. Cú pháp cũng dễ đọc hơn `require()`, điều này mang lại trải nghiệm tốt hơn cho nhà phát triển và tất cả chúng ta đều muốn điều đó!

## Khi nào nên sử dụng require và import?

Bạn sẽ sử dụng `require()` khi:

- Bạn đang làm việc trên một dự án Node.js cũ đã được bắt đầu trước khi ES6 ra mắt và chưa được cập nhật.

- Bạn cần dynamically load modules lúc runtime, chẳng hạn như trong tệp config hoặc nếu bạn cần tải mô-đun có điều kiện.

Bạn sẽ sử dụng `import` khi:

- Bất kỳ lúc nào khác vì đây là tiêu chuẩn hiện nay và hiệu quả hơn.

## Tổng kết

Nói chung, bạn nên sử dụng tính năng `import` bất cứ khi nào có thể, vì nó mang lại nhiều lợi ích hơn và là hệ thống module mới hơn, được áp dụng rộng rãi hơn. Tuy nhiên, có thể có trường hợp `require()` vẫn là lựa chọn tốt hơn, tùy thuộc vào yêu cầu cụ thể của bạn và môi trường bạn đang làm việc.

## Tham khảo

- [import](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/import)
- [Modules](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Modules)
