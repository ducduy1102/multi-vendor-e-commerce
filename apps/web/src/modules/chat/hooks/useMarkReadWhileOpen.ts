import { useEffect, useRef, useSyncExternalStore } from 'react';

import type { ChatScope } from '../types';
import { useMarkRead } from './useMarkRead';

function subscribeVisibility(onChange: () => void): () => void {
  document.addEventListener('visibilitychange', onChange);
  return () => document.removeEventListener('visibilitychange', onChange);
}
const isDocumentVisible = () => document.visibilityState !== 'hidden';

// Tab đang hiển thị (không bị ẩn/thu nhỏ). Phía server coi là hiển thị để SSR và lần render đầu khớp nhau.
function useIsDocumentVisible(): boolean {
  return useSyncExternalStore(subscribeVisibility, isDocumentVisible, () => true);
}

// Đánh dấu hội thoại đang mở là ĐÃ ĐỌC ngay khi người dùng thật sự nhìn thấy nó: có tin chưa đọc VÀ tab đang hiển thị.
// Tin đến lúc đang mở làm `unreadCount` tăng lại ⇒ tự đánh dấu tiếp; tab bị ẩn thì chờ tới khi hiển thị lại (không báo
// "đã xem" cho tin người dùng chưa hề thấy).
//
// Chặn vòng lặp khi đánh dấu lỗi: lỗi ⇒ danh sách được tải lại và `unreadCount` có thể quay về đúng giá trị cũ, nếu
// cứ gọi lại thì một lỗi bền (vd 403) thành vòng lặp yêu cầu vô tận. Nhớ cặp (hội thoại, số chưa đọc) vừa lỗi và chỉ
// thử lại khi số đó đổi (có tin mới) hoặc đổi hội thoại.
export function useMarkReadWhileOpen(
  scope: ChatScope,
  conversationId: string | null,
  unreadCount: number,
): void {
  const { mutate } = useMarkRead(scope);
  const isVisible = useIsDocumentVisible();
  const failedFor = useRef<string | null>(null);

  useEffect(() => {
    if (conversationId === null || unreadCount <= 0 || !isVisible) return;
    const attempt = `${conversationId}:${unreadCount}`;
    if (failedFor.current === attempt) return;
    mutate(conversationId, {
      onSuccess: () => {
        failedFor.current = null;
      },
      onError: () => {
        failedFor.current = attempt;
      },
    });
  }, [conversationId, unreadCount, isVisible, mutate]);
}
