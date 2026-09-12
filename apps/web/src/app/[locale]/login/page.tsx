import { LoginFormContainer } from "@/modules/auth";

// Message ứng với query param ?error= mà AuthController.googleCallback (BE)
// redirect về khi đăng nhập Google thất bại — trang này chỉ map sang tiếng
// Việt để hiển thị, không xử lý logic gì thêm.
const GOOGLE_LOGIN_ERROR_MESSAGES: Record<string, string> = {
  account_not_active: "Tài khoản của bạn hiện không hoạt động, vui lòng liên hệ hỗ trợ.",
  google_login_failed: "Đăng nhập bằng Google thất bại, vui lòng thử lại.",
};

interface LoginPageProps {
  searchParams: Promise<{ error?: string }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { error } = await searchParams;
  const initialError = error ? GOOGLE_LOGIN_ERROR_MESSAGES[error] : undefined;

  return (
    <div className="flex flex-1 items-center justify-center bg-zinc-50 px-4 py-16 dark:bg-black">
      <div className="w-full max-w-sm rounded-xl border border-border bg-background p-6 shadow-sm">
        <h1 className="mb-6 text-xl font-semibold">Đăng nhập</h1>
        <LoginFormContainer initialError={initialError} />
      </div>
    </div>
  );
}
