"use client";

import { useAuthStore } from "../store/auth.store";
import { ResendVerificationButton } from "./ResendVerificationButton";

// Nhắc feature-level, KHÔNG chặn truy cập — email chưa xác thực vẫn cho
// login/browse bình thường (xem auth-shop-status-architecture.md). Hiện gắn
// dạng banner toàn app (trong app/layout.tsx) vì hiện chưa có feature nào
// thật sự chặn hành động (EmailVerifiedGuard chưa gắn route nào — BE Bước
// 2.10, checkout/tạo shop chưa tồn tại); sẽ cân nhắc gắn theo action cụ thể
// khi các feature đó ra đời.
export function EmailVerificationBanner() {
  const user = useAuthStore((state) => state.user);

  if (!user || user.emailVerifiedAt) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center justify-center gap-3 bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">
      <span>Email của bạn chưa được xác thực.</span>
      <ResendVerificationButton size="sm" />
    </div>
  );
}
