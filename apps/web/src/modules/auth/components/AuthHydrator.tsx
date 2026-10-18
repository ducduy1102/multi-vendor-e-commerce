'use client';

import { useEffect, useRef } from 'react';

import { usePathname, useRouter } from '@/i18n/navigation';
import { decideAuthRedirect } from '@/shared/lib/auth-redirect';
import { setSessionLostHandler } from '@/shared/lib/session-refresh';

import { me } from '../services/auth.service';
import { useAuthStore } from '../store/auth.store';

// Gọi 1 lần lúc app khởi động để khôi phục `user` vào store — access token
// là httpOnly cookie nên JS không đọc được, phải hỏi lại BE mới biết ai
// đang đăng nhập (vd sau khi F5 trang). 401 (chưa đăng nhập/hết hạn) là
// trạng thái bình thường, không phải lỗi cần hiển thị.
//
// Access token chỉ sống 15 phút: `me()` đi qua apiFetch nên 401 ở đây tự gia hạn bằng refresh token (nếu
// còn) rồi hỏi lại — người mở lại tab sau hơn 15 phút vẫn được nhận ra (Week10.md 2.1). Cũng ở đây đăng
// ký handler "mất phiên" cho cả app (shared/lib không import modules/auth): gia hạn bị BE từ chối thì
// xoá user khỏi store và, nếu đang ở route cần đăng nhập, đưa về /login kèm `?next=`.
export function AuthHydrator() {
  const setUser = useAuthStore((state) => state.setUser);
  const clearUser = useAuthStore((state) => state.clearUser);
  const setIsHydrating = useAuthStore((state) => state.setIsHydrating);
  const router = useRouter();
  // usePathname của next-intl đã bỏ prefix locale — đúng đầu vào decideAuthRedirect cần. Giữ trong ref để
  // handler (đăng ký một lần) luôn đọc được đường dẫn HIỆN TẠI mà không phải đăng ký lại mỗi lần điều hướng.
  const pathname = usePathname();
  const pathnameRef = useRef(pathname);
  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);

  useEffect(() => {
    setSessionLostHandler(() => {
      clearUser();
      // Cả hai cờ false: phiên vừa bị từ chối nên không còn dấu vết nào (BE đã xoá cookie), JS không đọc
      // được cookie httpOnly để kiểm lại.
      const redirectTo = decideAuthRedirect({
        pathname: pathnameRef.current,
        search: window.location.search,
        isAuthenticated: false,
        hasSessionTrace: false,
      });
      if (redirectTo) {
        router.replace(redirectTo);
        router.refresh();
      }
    });
    return () => setSessionLostHandler(null);
  }, [clearUser, router]);

  useEffect(() => {
    // finally hạ cờ isHydrating cho cả 3 nhánh (thành công, 401, lỗi mạng)
    // — catch() ở trên không phân biệt 401 với lỗi mạng khác (cả 2 đều coi
    // là "chưa xác định được user", không hiển thị gì thêm), nhưng dù nhánh
    // nào cũng phải kết thúc trạng thái "đang chờ" để UI (Header...) ngưng
    // hiện placeholder.
    me()
      .then(setUser)
      .catch(() => {})
      .finally(() => setIsHydrating(false));
  }, [setUser, setIsHydrating]);

  return null;
}
