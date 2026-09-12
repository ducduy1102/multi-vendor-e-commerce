"use client";

import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";
import { Button } from "@/shared/components/ui/button";

import { useAuthStore } from "../store/auth.store";

// Tạm để đỡ phải gõ URL /login, /register khi test tay — chỉ hiện khi
// chưa đăng nhập (ngược với LogoutButton), bỏ khi có trang chủ/dashboard
// thật + có menu điều hướng đàng hoàng.
export function GuestAuthLinks() {
  const t = useTranslations("auth");
  const user = useAuthStore((state) => state.user);

  if (user) {
    return null;
  }

  return (
    <div className="flex items-center gap-2">
      <Button variant="outline" nativeButton={false} render={<Link href="/login" />}>
        {t("guestLoginLink")}
      </Button>
      <Button variant="outline" nativeButton={false} render={<Link href="/register" />}>
        {t("guestRegisterLink")}
      </Button>
    </div>
  );
}
