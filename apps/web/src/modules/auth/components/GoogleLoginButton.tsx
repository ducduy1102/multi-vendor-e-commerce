"use client";

import { useTranslations } from "next-intl";

import { Button } from "@/shared/components/ui/button";
import { API_BASE_URL, API_PREFIX } from "@/shared/lib/api-client";

// "use client" dù component thuần tĩnh (không state/effect) — nơi duy nhất
// dùng component này là LoginFormContainer/RegisterFormContainer, cả 2 đều
// đã là Client Component, nên đây thực chất luôn chạy phía client (Next.js
// không cho Server Component làm con trực tiếp của Client Component qua
// import bình thường) — khai rõ "use client" để dùng được useTranslations()
// (hook, không gọi được từ Server Component).
//
// Điều hướng cả trang (thẻ <a>, KHÔNG phải fetch) — OAuth là flow redirect
// dựa trên trình duyệt, không gọi được qua JS/fetch bình thường. BE
// (GET /api/v1/auth/google) tự redirect sang Google, rồi Google redirect lại
// BE (/api/v1/auth/google/callback) set cookie xong redirect thẳng về FE.
export function GoogleLoginButton() {
  const t = useTranslations("auth");

  return (
    <Button
      type="button"
      variant="outline"
      className="w-full"
      nativeButton={false}
      render={<a href={`${API_BASE_URL}${API_PREFIX}/auth/google`} />}
    >
      {t("googleSignIn")}
    </Button>
  );
}
