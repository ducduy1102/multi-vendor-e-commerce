"use client";

import { useEffect } from "react";

import { me } from "../services/auth.service";
import { useAuthStore } from "../store/auth.store";

// Gọi 1 lần lúc app khởi động để khôi phục `user` vào store — access token
// là httpOnly cookie nên JS không đọc được, phải hỏi lại BE mới biết ai
// đang đăng nhập (vd sau khi F5 trang). 401 (chưa đăng nhập/hết hạn) là
// trạng thái bình thường, không phải lỗi cần hiển thị.
export function AuthHydrator() {
  const setUser = useAuthStore((state) => state.setUser);
  const setIsHydrating = useAuthStore((state) => state.setIsHydrating);

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
