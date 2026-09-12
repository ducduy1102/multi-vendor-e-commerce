import { getTranslations } from "next-intl/server";

import { LoginFormContainer } from "@/modules/auth";

interface LoginPageProps {
  searchParams: Promise<{ error?: string }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { error } = await searchParams;
  const t = await getTranslations("auth");

  // Message ứng với query param ?error= mà AuthController.googleCallback (BE)
  // redirect về khi đăng nhập Google thất bại — trang này chỉ map sang message
  // đã dịch sẵn để hiển thị, không xử lý logic gì thêm.
  const GOOGLE_LOGIN_ERROR_MESSAGES: Record<string, string> = {
    account_not_active: t("loginGoogleErrorAccountNotActive"),
    google_login_failed: t("loginGoogleErrorFailed"),
  };
  const initialError = error ? GOOGLE_LOGIN_ERROR_MESSAGES[error] : undefined;

  return (
    <div className="flex flex-1 items-center justify-center bg-zinc-50 px-4 py-16 dark:bg-black">
      <div className="w-full max-w-sm rounded-xl border border-border bg-background p-6 shadow-sm">
        <h1 className="mb-6 text-xl font-semibold">{t("loginTitle")}</h1>
        <LoginFormContainer initialError={initialError} />
      </div>
    </div>
  );
}
