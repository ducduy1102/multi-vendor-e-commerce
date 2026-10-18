'use client';

import { useSyncExternalStore } from 'react';

// Không có gì để đăng ký: giá trị chỉ khác nhau giữa render phía server/hydration và render phía client.
const subscribe = () => () => {};

// `false` khi render trên server VÀ trong lượt hydration đầu tiên, `true` ngay sau khi React đã gắn xong vào
// DOM. Dùng để khoá nút gửi form cho tới khi `onSubmit` của React thật sự đã được gắn (Week10.md 2.2): bấm
// "Đăng nhập" trước hydrate thì trình duyệt tự gửi form theo kiểu GET và mật khẩu lên thẳng URL.
//
// `useSyncExternalStore` thay vì `useEffect(() => setX(true))`: snapshot server là `false` nên HTML do server
// sinh ra đã có nút bị khoá (không phải chờ một lượt effect), hydration không lệch HTML, và không có setState
// trong effect.
export function useIsHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
