'use client';

import { useTranslations } from 'next-intl';

import { Button } from '@/shared/components/ui/button';
import { API_BASE_URL, API_PREFIX } from '@/shared/lib/api-client';

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
interface GoogleLoginButtonProps {
  // RegisterFormContainer truyền t("registerGoogleSignIn") để chữ trên nút
  // khớp ngữ cảnh "Đăng ký" thay vì mặc định "Đăng nhập" — cùng 1 route OAuth
  // BE (login/register gộp chung), chỉ khác label hiển thị theo trang gọi.
  label?: string;
  // Đích quay lại sau khi đăng nhập Google thành công (Week7.md 1.2/3.2) — đã
  // được safeNextPath kiểm ở page.tsx (Server Component), truyền nguyên qua
  // props tới đây. BE (GoogleAuthGuard) kiểm lại lần nữa trước khi dùng.
  next?: string;
}

export function GoogleLoginButton({ label, next }: GoogleLoginButtonProps) {
  const t = useTranslations('auth');
  const googleAuthUrl = `${API_BASE_URL}${API_PREFIX}/auth/google`;
  const href = next ? `${googleAuthUrl}?next=${encodeURIComponent(next)}` : googleAuthUrl;

  return (
    <Button
      type="button"
      variant="outline"
      className="w-full"
      nativeButton={false}
      render={<a href={href} />}
    >
      {label ?? t('googleSignIn')}
    </Button>
  );
}
