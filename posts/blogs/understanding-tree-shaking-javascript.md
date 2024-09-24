---
title: Tìm hiểu về Tree shaking trong JavaScript
authors: hunghg255
tags: [js, tree shaking]
image: https://blog.hunghg.me/blogs/tree-shaking.webp
date: '2024-09-24'
---

Tìm hiểu về Tree shaking trong JavaScript: Tìm hiểu nhanh

Khi các ứng dụng web hiện đại ngày càng phức tạp thì nhu cầu tối ưu hóa hiệu suất của chúng cũng tăng theo. Một kỹ thuật mạnh mẽ đã trở nên phổ biến trong những năm gần đây là Tree shaking. Nếu bạn đã nghe thuật ngữ này nhưng không chắc chắn ý nghĩa của nó hoặc cách thức hoạt động của nó thì bài đăng này là dành cho bạn.

<!--truncate-->

## Tree shaking là gì?

Tree shaking là một hình thức loại bỏ mã chết. Đó là một kỹ thuật được các bundler JavaScript (như Webpack hoặc Rollup) sử dụng để xóa mã không thực sự được sử dụng (tức là mã chết) khỏi file bundle cuối cùng của bạn. Hãy nghĩ về việc rung chuyển một cái cây và những chiếc lá chết rơi xuống từ nó. Đây chính xác là những gì đang xảy ra, ngoại trừ việc chúng tôi đang loại bỏ những đoạn mã không được sử dụng để làm cho ứng dụng của chúng tôi gọn gàng và nhanh chóng!

## Tree shaking hoạt động như thế nào?

Tree shaking dựa trên các ES6 modules, sử dụng các câu lệnh `import` và `export`. Không giống như CommonJS, tải toàn bộ modules ngay cả khi bạn chỉ sử dụng một phần nhỏ, ES6 modules cho phép statically analyzed. Điều này có nghĩa là bundler có thể xác định phần nào trong mã của bạn đang thực sự được sử dụng và phần nào không. [Xem thêm bài này](https://blog.hunghg.me/blogs/require-vs-import-in-javascript) để tìm hiểu thêm về sự khác biệt giữa `require` và `import`.

Đây là một ví dụ:

```js
// math.js
export function add(a, b) {
  return a + b;
}

export function multiply(a, b) {
  return a * b;
}

// main.js
import { add } from './math.js';

console.log(add(2, 3)); // Output: 5
```

Trong ví dụ này, nếu bật tính năng Tree shaking, hàm `multiply` từ `math.js` sẽ bị xóa khỏi file bundle vì nó không bao giờ được sử dụng. Điều này dẫn đến thời gian tải nhanh hơn và hiệu suất tốt hơn bằng cách giảm kích thước gói.

Đây là một ví dụ nhỏ, nhưng trong một dự án lớn khi imput nhiều gói JavaScript lớn, thời gian tải sẽ trở thành điều bạn phải suy nghĩ vì thời gian tải không tốt dẫn đến trải nghiệm người dùng không tốt, đặc biệt là với người dùng trên mạng hoặc thiết bị yếu. Không phải ai cũng có MacBook Pro mới nhất =))

## Làm thế nào để bật Tree shaking

May mắn cho chúng ta, có các bundler hỗ trợ tree shaking ngay từ đầu như Webpack và Rollup. Chỉ cần đảm bảo mã của bạn được viết trong ES6 modules.

## Hạn chế của tree shaking

Bây giờ chúng ta đã nói về việc điều này tuyệt vời như thế nào, nhưng có một số hạn chế, cụ thể là:

- Side Effect: Nếu module có side effect (ví dụ: sửa đổi một biến toàn cục, polyfills,...), việc tree shaking có thể không loại bỏ được module đó, ngay cả khi mã không được sử dụng trực tiếp. Bạn có thể config những module bằng cách đánh dấu các module là `side-effect-free` trong `package.json` của mình.
- Các module không phải ES6: Tree shaking chỉ hoạt động với các module ES6 nên nếu dự án của bạn sử dụng CommonJS hoặc một số hệ thống module khác thì nó sẽ không hoạt động.

## Tham khảo

- [Webpack Tree Shaking](https://webpack.js.org/guides/tree-shaking/)
