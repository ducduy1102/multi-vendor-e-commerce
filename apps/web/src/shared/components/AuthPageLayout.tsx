import { AuthCard } from './AuthCard';
import { LocaleSwitcher } from './LocaleSwitcher';

interface AuthPageLayoutProps {
  children: React.ReactNode;
  // Query cần giữ khi người dùng đổi ngôn ngữ ngay trên trang này (`next` của /login và /register, `token` của
  // /reset-password) — xem LocaleSwitcher.
  localeQuery?: Record<string, string>;
}

// Khung chung của 4 trang xác thực không có Header (/login, /register, /forgot-password, /reset-password —
// HIDDEN_CHROME_PATHS): card ở giữa màn hình kèm nút đổi ngôn ngữ phía trên. Trước đây các trang này không có
// nút nào; từ khi FE đặt `localeDetection: false` (Week10.md 2.3) trình duyệt tiếng Anh không còn được tự đưa
// sang `/en/...` nên đây là đường duy nhất để người dùng đổi ngôn ngữ ngay tại chỗ.
export function AuthPageLayout({ children, localeQuery }: AuthPageLayoutProps) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 py-16">
      <div className="flex w-full max-w-sm justify-end">
        <LocaleSwitcher query={localeQuery} />
      </div>
      <AuthCard>{children}</AuthCard>
    </div>
  );
}
