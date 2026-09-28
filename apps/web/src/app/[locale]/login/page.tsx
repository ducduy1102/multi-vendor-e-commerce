import { safeNextPath } from "@ecommerce/types";
import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import { LoginFormContainer } from "@/modules/auth";
import { AuthCard } from "@/shared/components/AuthCard";
import { ChotMark } from "@/shared/components/ChotMark";

interface LoginPageProps {
  searchParams: Promise<{ error?: string; next?: string }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  // 3 await độc lập (không cái nào phụ thuộc kết quả cái kia) — Promise.all
  // thay vì await nối tiếp (vercel-react-best-practices, async-parallel).
  const [{ error, next: rawNext }, t, tHeader] = await Promise.all([
    searchParams,
    getTranslations("auth"),
    getTranslations("header"),
  ]);
  // Đọc 1 lần lúc render (Server Component), không dùng useSearchParams()
  // (rules/frontend.md mục 1). Kiểm lại bằng safeNextPath dù đích thường tới
  // từ proxy.ts (không tin nguyên xi query param — Week7.md 1.2).
  const next = safeNextPath(rawNext) ?? undefined;

  // Message ứng với query param ?error= mà AuthController.googleCallback (BE)
  // redirect về khi đăng nhập Google thất bại — trang này chỉ map sang message
  // đã dịch sẵn để hiển thị, không xử lý logic gì thêm.
  const GOOGLE_LOGIN_ERROR_MESSAGES: Record<string, string> = {
    account_not_active: t("loginGoogleErrorAccountNotActive"),
    google_login_failed: t("loginGoogleErrorFailed"),
  };
  const initialError = error ? GOOGLE_LOGIN_ERROR_MESSAGES[error] : undefined;

  return (
    <div className="flex flex-1 items-center justify-center px-4 py-16">
      <AuthCard>
        <Link href="/" className="mb-6 flex items-center justify-center gap-1.5">
          <ChotMark className="size-7 shrink-0" />
          <span className="font-semibold text-brand">{tHeader("siteName")}</span>
        </Link>
        <h1 className="mb-6 text-xl font-semibold">{t("loginTitle")}</h1>
        <LoginFormContainer initialError={initialError} next={next} />
      </AuthCard>
    </div>
  );
}
