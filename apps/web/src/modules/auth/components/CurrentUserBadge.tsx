"use client";

import { useAuthStore } from "../store/auth.store";

export function CurrentUserBadge() {
  const user = useAuthStore((state) => state.user);

  if (!user) {
    return <p className="text-sm text-muted-foreground">Chưa đăng nhập</p>;
  }

  return (
    <p className="text-sm text-muted-foreground">
      Đang đăng nhập: {user.email} ({user.role})
    </p>
  );
}
