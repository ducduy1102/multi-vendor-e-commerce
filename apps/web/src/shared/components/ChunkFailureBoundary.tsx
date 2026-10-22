'use client';

import { Component, type ReactNode } from 'react';

// Chunk tải LỖI (mạng chập chờn đúng lúc vừa vào trang) làm `React.lazy` ném lỗi khi render; không rào lại thì lỗi đó bay
// lên `error.tsx` và thay cả trang bằng màn hình lỗi chỉ vì mất biểu tượng/huy hiệu của một tiện ích (tin nhắn, thông
// báo). Các mảnh nạp động này chỉ là tiện ích nên lỗi thì im lặng không dựng gì (tải lại trang sẽ thử lại). Dùng chung cho
// lazy-chat.tsx và lazy-notification.tsx.
export class ChunkFailureBoundary extends Component<
  { children: ReactNode },
  { hasFailed: boolean }
> {
  state = { hasFailed: false };

  static getDerivedStateFromError() {
    return { hasFailed: true };
  }

  render() {
    return this.state.hasFailed ? null : this.props.children;
  }
}
