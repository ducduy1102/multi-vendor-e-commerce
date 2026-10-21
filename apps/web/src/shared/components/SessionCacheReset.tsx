'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import { useAuthStore } from '@/modules/auth';
import { resetChatOutbox } from '@/modules/chat';

// Xoá MỌI cache dữ liệu phía client khi NGƯỜI DÙNG ĐANG ĐĂNG NHẬP ĐỔI NGƯỜI hoặc đăng xuất (đăng xuất, đổi tài khoản,
// phiên bị thu hồi). `QueryClient` dùng chung cho cả phiên trình duyệt và không tự xoá khi đăng xuất — người dùng kế
// tiếp trên cùng tab sẽ thấy ngay dữ liệu riêng của người trước (tin nhắn, đơn hàng, địa chỉ, wishlist...) từ cache cho
// tới khi tải lại xong (đã đo bằng trình duyệt thật cho chat). Làm một chỗ duy nhất, theo ĐỔI ID chứ không theo nút
// "Đăng xuất": mọi đường mất phiên (nút, hết hạn, bị thu hồi, đăng nhập tài khoản khác) đều đi qua đây, và module mới
// thêm sau tự được dọn mà không phải nhớ gọi gì.
//
// Chỉ xoá khi đã TỪNG có người đăng nhập trước đó (`previous !== null`) mà id khác đi: lần khôi phục phiên lúc mở trang
// (null → id, do AuthHydrator hỏi /auth/me) không được xoá — khi đó chưa có dữ liệu của ai khác, mà các truy vấn đã
// chạy song song với /auth/me sẽ bị loại oan. Làm mới phiên (cùng id) cũng không xoá.
//
// `resetChatOutbox` vì hộp chờ gửi của chat là Zustand chứ không phải cache truy vấn nên `clear()` không với tới
// (module chat không biết đăng xuất — xem rules/frontend.md); các store Zustand khác có nơi dọn riêng (giỏ hàng: CartHydrator).
export function SessionCacheReset() {
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const queryClient = useQueryClient();
  const previousUserId = useRef(userId);

  useEffect(() => {
    const previous = previousUserId.current;
    previousUserId.current = userId;
    if (previous !== null && previous !== userId) {
      queryClient.clear();
      resetChatOutbox();
    }
  }, [userId, queryClient]);

  return null;
}
