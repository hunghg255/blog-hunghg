---
title: Instance Hook Pattern
author: hunghg255
tags: [Reactjs, Ant Design]
image: https://react.dev/_next/image?url=%2Fimages%2Fuwu.png&w=640&q=75
date: '2025-01-07'
---

Khi xây dựng các component, điều quan trọng là phải giữ logic rõ ràng và có thể tái sử dụng. Một cách thuận tiện để thực hiện việc này là sử dụng Instance Hook Pattern. Lần đầu tiên mình phát hiện ra cái này này trong hook [Form.useForm](https://ant.design/components/form?locale=en-US#forminstance) của Ant Design. Mình thực sự không biết liệu nó đã có tên chưa nhưng “Instance Hook Pattern” nghe có vẻ lạ mắt. Nhưng vì Forms vốn đã phức tạp nên chúng ta hãy sử dụng điều gì đó cơ bản hơn để hiểu khái niệm đằng sau phương pháp này.

<!--truncate-->

## Tạo Custom Hook

Vì vậy, đây là ý tưởng cơ bản: nói chung, một component nên xử lý state và logic của chính nó. Nhưng đôi khi, chúng ta có thể muốn kiểm soát state đó từ bên ngoài. Sẽ rất tốt nếu có tùy chọn này, chẳng hạn như trong thư viện UI. Pattern này cho phép sự linh hoạt này.

Instance Hook Pattern liên kết state và hành vi của một component với hook tùy chỉnh. Bạn có thể coi nó giống như một điều khiển từ xa cho chính component đó và cho phép người dùng kiểm soát các hành động cụ thể.

Hãy xem Pattern này hoạt động với Dialog Component đơn giản.

```tsx title=App.tsx
import Dialog from "../components/ui/Dialog";

const SomePage = () => {
  // LƯU Ý: custom hook này sẽ đảm bảo tất cả các component trên page này sẽ
  // re-render khi dialog state thay đổi. Điều này không lý tưởng nhưng bù lại chúng ta có được sự linh hoạt
  // để kiểm soát state của dialog từ bất kỳ đâu trên trang. Sau này chúng ta sẽ xem cách tránh chi phí này.
  const dialogInstance = Dialog.useDialog();

  return (
    <>
      <Dialog dialog={dialogInstance} onClickOutside={dialogInstance.close}>
          <p>This is a dialog</p>
      </Dialog>

      <button onClick={dialogInstance.open}>Open Dialog</button>
      <div>
          Dialog is {dialogInstance.isOpen ? "open" : "closed"}
      </div>
    <>
  );
};
```

## Vậy điều gì làm cho điều này khác biệt từ Custom Hook?

- Co-located Logic: hook và component tồn tại cùng nhau. Điều này đảm bảo rằng component Dialog chỉ sử dụng API cụ thể mà useDialog cung cấp, giúp maintain toàn bộ nội dung dễ dàng hơn.

- Controlled API: Hook trả về các function và state mà người dùng có thể tương tác. Điều này tạo ra một ranh giới rõ ràng về những gì người dùng có thể làm với component đó, nhờ đó bạn tránh được những hành vi lộn xộn, không mong muốn.

- Unified State: component này cũng sử dụng gói state mà hook cung cấp nội bộ (chúng ta sẽ thấy cách hoạt động sau). Vì vậy, mỗi phần của component đều có quyền truy cập vào state của component và các hành vi có sẵn của component đó.

- Totally Optional: cho phép component quản lý state của chính nó theo mặc định.

## Khả năng kết hợp: Tại sao pattern này lại tuyệt vời

Sức mạnh thực sự của pattern này xuất hiện khi bạn có nhiều instance của component. Giả sử bạn muốn quản lý hai Dialog trên cùng một trang:

```tsx title=App.tsx
const SomePage = () => {
  const dialog1 = Dialog.useDialog();
  const dialog2 = Dialog.useDialog();

  return (
    <>
      <Dialog dialog={dialog1} onClickOutside={dialog1.close}>
          <p>Dialog 1</p>
      </Dialog>
      <button onClick={() => {
          dialog1.open();
          dialog2.close();
      }}>
          Open Dialog 1 but Close Dialog 2
      </button>

      <Dialog dialog={dialog2}>
          <p>Dialog 2</p>
      </Dialog>
      <button onClick={dialog2.open}>Open Dialog 2</button>

      <div>
          Dialog 1 is {dialog1.isOpen ? "open" : "closed"} and
          Dialog 2 is {dialog1.isOpen === dialog2.isOpen && "also"} {dialog2.isOpen ? "open" : "closed"}
      </div>
    <>
  );
};
```

Bạn không chỉ có thể quản lý hai Dialog một cách trực quan mà còn có thể sử dụng cả hai state của chúng để tạo ra các tương tác phức tạp.

## Đằng sau nó là gì?

- Hãy cùng tìm hiểu xem Dialog component trông như thế nào.

```tsx title=Dialog.tsx
import { useDialog } from "./use-dialog";

export type DialogInstance = {
    open: () => void;
    close: () => void;
    toggle: () => void;
    isOpen: boolean;
};

const Dialog: React.FC<{
    dialog: DialogInstance, children?: React.ReactNode, onClickOutside?: () => void
}> = ({ dialog, children, onClickOutside }) => {

    return (
        <dialog className="p-4">
            <DialogHeader dialog={dialog} closable title="My Dialog" />
            <div className="mt-4">
                {children}
            </div>
        </dialog>
    );
};

// This enables the `Dialog.useDialog()` API
export const Object.assign(Dialog, {
    useDialog,
});
```

```tsx title=use-dialog.ts
import { DialogInstance } from './Dialog';

export const useDialog = (): DialogInstance => {
  const [isOpen, setIsOpen] = useState(false);

  return {
    open: () => setIsOpen(true),
    close: () => setIsOpen(false),
    toggle: () => setIsOpen((op) => !op),
    isOpen,
  };
};
```

```tsx title=DialogHeader.tsx
import { DialogInstance } from './Dialog';
import CrossIcon from '../../assets/cross.svg';

const DialogHeader: React.FC<{ dialog: DialogInstance; title: string; closable?: boolean }> = ({
  dialog,
  title,
  closable,
}) => {
  return (
    <div className='flex items-center justify-space-between p-4'>
      <h1>{title}</h1>
      {closable && (
        <button onClick={dialog.close}>
          <CrossIcon />
        </button>
      )}
    </div>
  );
};

export default DialogHeader;
```

## Cải thiện tính linh hoạt

Đôi khi, người sử dụng component `Dialog` có thể không cần kiểm soát trạng thái của `Dialog`. Trong những trường hợp này, chúng ta có thể biến việc chuyển `DialogInstance` thành tùy chọn, cho phép sử dụng linh hoạt hơn.

Để đạt được điều này, chúng ta có thể sửa đổi hook `useDialog` để nó có thể tạo `DialogInstance` của riêng nó hoặc sử dụng lại hook hiện có nếu được cung cấp.

```tsx title=use-dialog.ts
import { useMemo, useState, useCallback } from 'react';
import { DialogInstance } from './Dialog';

export const useDialog = (dialog?: DialogInstance): DialogInstance => {
  const [isOpen, setIsOpen] = useState(false);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  const toggle = useCallback(() => setIsOpen((op) => !op), []);

  return useMemo(() => {
    return (
      dialog ?? {
        open,
        close,
        toggle,
        isOpen,
      }
    );
  }, [dialog, isOpen]);
};
```

Việc sửa đổi này cho phép component Dialog hoạt động ngay cả khi không có DialogInstance nào được truyền vào, nếu trong trường hợp đó, nó sẽ mặc định quản lý trạng thái của chính nó.

```tsx title=Dialog.tsx
import { useDialog } from './use-dialog';
// ...

const Dialog: React.FC<{
  dialog?: DialogInstance;
  children?: React.ReactNode;
  onClickOutside?: () => void;
}> = ({ dialog, children, onClickOutside }) => {
  const dialogInstance = useDialog(dialog); // <-- passing in the dialog

  return (
    <dialog className='p-4'>
      <DialogHeader dialog={dialogInstance} closable title='My Dialog' />
      <div className='mt-4'>{children}</div>
    </dialog>
  );
};

// ...
```

## Kết luận

Instance Hook Pattern là một pattern đơn giản trong React cho phép bạn tạo các component có thể tái sử dụng với hành vi được kiểm soát. Mình thích coi nó như một gói trạng thái có thể được truyền đi khắp nơi để kiểm soát component được liên kết với nó. Điều này thực sự có mối quan hệ tốt với `Compound Components Pattern` và `Render Props Pattern`.
