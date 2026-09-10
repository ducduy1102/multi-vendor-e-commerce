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

  useEffect(() => {
    me()
      .then(setUser)
      .catch(() => {});
  }, [setUser]);

  return null;
}
