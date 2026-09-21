'use client';

import { ChevronDown, Store, UserPlus } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Link, usePathname } from '@/i18n/navigation';
import { LogoutButton, useAuthStore } from '@/modules/auth';
import { useMyShop } from '@/modules/shop';
import { ChotMark } from '@/shared/components/ChotMark';
import { Button } from '@/shared/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/components/ui/dropdown-menu';
import { LocaleSwitcher } from './LocaleSwitcher';
import { ThemeToggle } from './ThemeToggle';

// "Nguyễn Văn A" -> "NA" (chữ đầu của từ đầu + từ cuối, bỏ qua đệm giữa) —
// đúng cách viết tắt tên tiếng Việt thông thường, không phải cắt 2 ký tự
// đầu (sẽ ra "NG" sai ý).
function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function UserAvatar({ name }: { name: string }) {
  return (
    <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
      {initialsFromName(name)}
    </span>
  );
}

// Trang đăng nhập/đăng ký tự có layout riêng (card giữa màn hình, không
// cần điều hướng) — Header ở đây chỉ thừa, không giúp gì cho luồng auth.
const HIDDEN_ON_PATHS = ['/login', '/register'];

// Header là app-chrome hiển thị ở MỌI trang (không thuộc riêng 1 route/
// feature cụ thể) — khác pattern "composition root ở app/<route>/page.tsx"
// đã dùng cho product+shop (Week4.md Bước 3.6), Header cần đọc CẢ
// useAuthStore (modules/auth) lẫn useMyShop (modules/shop) ngay trong chính
// nó để quyết định nội dung dropdown tài khoản. Đặt ở shared/ (không thuộc
// module nào) và import 2 hook qua đúng public API của từng module — cùng
// tinh thần ngoại lệ "hook dùng chung ≥ 2 module" đã áp dụng cho
// useAuthStore ở modules/shop (rules/general.md mục 1).
export function Header() {
  const t = useTranslations('header');
  const tAuth = useTranslations('auth');
  const pathname = usePathname();
  const user = useAuthStore((state) => state.user);
  const myShopQuery = useMyShop({ enabled: !!user });

  // null trong lúc đang loading (chưa biết seller hay chưa) — cố tình
  // KHÔNG hiện mục này lúc đó, tránh nhấp nháy sai link rồi đổi ngay sau.
  const shopLink = !user
    ? null
    : myShopQuery.data
      ? { href: '/seller/products' as const, label: t('myProductsLink'), icon: Store }
      : myShopQuery.isSuccess
        ? { href: '/seller/onboarding' as const, label: t('becomeSellerLink'), icon: UserPlus }
        : null;

  // Đặt SAU mọi hook (Rules of Hooks — không được return sớm trước khi các
  // hook ở trên đã chạy đủ, dù trang này thường chưa đăng nhập nên
  // useMyShop() cũng đang disabled, không tốn request thật nào).
  if (HIDDEN_ON_PATHS.includes(pathname)) {
    return null;
  }

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-1.5 px-3 py-2.5 sm:gap-4 sm:px-4">
        <Link href="/" className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          <ChotMark className="size-7 shrink-0" />
          <span className="font-semibold whitespace-nowrap text-brand">{t('siteName')}</span>
        </Link>

        <div className="flex items-center gap-1.5 sm:gap-3">
          <ThemeToggle />
          <LocaleSwitcher />

          {!user ? (
            <div className="flex items-center gap-1.5 sm:gap-2">
              <Button variant="outline" nativeButton={false} render={<Link href="/login" />}>
                {tAuth('guestLoginLink')}
              </Button>
              <Button nativeButton={false} render={<Link href="/register" />}>
                {tAuth('guestRegisterLink')}
              </Button>
            </div>
          ) : (
            // openOnHover: mở thêm khi rê chuột (PC) — không thay thế hành vi
            // click mặc định, chỉ CỘNG THÊM. Thiết bị cảm ứng (mobile) không
            // bắn sự kiện hover thật nên tự nhiên chỉ còn lại click, không
            // cần tách 2 code path riêng cho desktop/mobile.
            <DropdownMenu>
              <DropdownMenuTrigger
                openOnHover
                render={
                  <Button type="button" variant="ghost" className="gap-1.5 px-1.5">
                    <UserAvatar name={user.name} />
                    <span className="max-w-32 truncate text-sm font-medium text-foreground">
                      {user.name}
                    </span>
                    <ChevronDown className="size-4 text-muted-foreground" />
                  </Button>
                }
              />
              {/* min-w-48 ghi đè `min-w-32` mặc định — dropdown mặc định
                  rộng bằng đúng trigger (--anchor-width), không đủ chỗ cho
                  "Sản phẩm của tôi" trên 1 dòng. */}
              <DropdownMenuContent align="end" className="min-w-48">
                {/* TODO: bật lại mục "Trang cá nhân" (key i18n header.myAccountLink,
                    giữ nguyên trong messages/*.json) khi có trang thật để trỏ tới —
                    hiện chưa route nào trong roadmap làm riêng trang này, gần nhất
                    là Wishlist (Tuần 5) hoặc "Đơn hàng của tôi" (Tuần 8). Ẩn tạm vì
                    trỏ "/" không có đích thật, dễ gây hiểu nhầm là bug. */}
                {shopLink && (
                  <>
                    <DropdownMenuItem render={<Link href={shopLink.href} />}>
                      <shopLink.icon />
                      {shopLink.label}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                )}
                <LogoutButton />
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>
    </header>
  );
}
