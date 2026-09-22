'use client';

import { ChevronDown, Menu, Store, UserPlus } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Link, usePathname } from '@/i18n/navigation';
import { LogoutButton, useAuthStore } from '@/modules/auth';
import { useMyShop } from '@/modules/shop';
import { ChotMark } from '@/shared/components/ChotMark';
import { Container } from '@/shared/components/Container';
import { Button } from '@/shared/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/components/ui/dropdown-menu';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/shared/components/ui/sheet';
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
  const isHydrating = useAuthStore((state) => state.isHydrating);
  const myShopQuery = useMyShop({ enabled: !!user });

  // Khác bản trước (chỉ dùng trong dropdown, ẩn hẳn khi guest) — giờ còn
  // hiển thị ở thanh trên (desktop) và Sheet (mobile), cả 2 chỗ khách chưa
  // đăng nhập cũng thấy được link "Trở thành người bán". Bấm vào khi chưa
  // đăng nhập vẫn an toàn: /seller/onboarding nằm trong PROTECTED_PATH_PREFIXES
  // ở proxy.ts, tự redirect sang /login — không cần Header tự check thêm.
  // null chỉ còn xảy ra khi đã đăng nhập nhưng useMyShop() chưa resolve
  // xong (tránh nhấp nháy sai link rồi đổi ngay sau).
  const shopLink =
    user && myShopQuery.data
      ? { href: '/seller/products' as const, label: t('myProductsLink'), icon: Store }
      : !user || myShopQuery.isSuccess
        ? { href: '/seller/onboarding' as const, label: t('becomeSellerLink'), icon: UserPlus }
        : null;

  // Đặt SAU mọi hook (Rules of Hooks — không được return sớm trước khi các
  // hook ở trên đã chạy đủ, dù trang này thường chưa đăng nhập nên
  // useMyShop() cũng đang disabled, không tốn request thật nào).
  if (HIDDEN_ON_PATHS.includes(pathname)) {
    return null;
  }

  // Dùng chung cho cả thanh trên (desktop) lẫn hàng chính (mobile) — 1
  // nguồn duy nhất cho trạng thái Guest/loading/đã đăng nhập, tránh viết
  // lại 2 lần rồi lệch nhau. Render 2 lần ở 2 vị trí khác nhau (ẩn/hiện
  // bằng CSS theo breakpoint) là hợp lệ với React — không phải trường hợp
  // "2 khối cùng mount đụng chung 1 field form" (rules/frontend.md mục 5),
  // component ở đây không dùng register().
  const accountCluster = isHydrating ? (
    // Placeholder cùng kích thước (h-8, khớp Button size="default") thay vì
    // bỏ trống hẳn — chờ AuthHydrator biết chắc user đã đăng nhập hay chưa
    // (xem auth.store.ts) trước khi quyết định hiện nút Guest hay dropdown
    // tài khoản, tránh nháy 1 nhịp sai trạng thái cho người đã đăng nhập
    // lúc F5 trang.
    <div className="flex items-center gap-1.5 sm:gap-2" aria-hidden="true">
      <div className="h-8 w-16 animate-pulse rounded-lg bg-muted sm:w-20" />
      <div className="h-8 w-16 animate-pulse rounded-lg bg-muted sm:w-20" />
    </div>
  ) : !user ? (
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
  );

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background">
      {/* Thanh trên — chỉ desktop (md+), ẩn hẳn ở mobile (thay bằng Sheet
          mở từ nút menu ở hàng chính). Trái: link "Kênh người bán". Phải:
          ThemeToggle, LocaleSwitcher, cụm tài khoản. */}
      <div className="hidden border-b border-border/60 md:block">
        <Container className="flex items-center justify-between gap-4 py-1.5">
          {shopLink ? (
            <Link
              href={shopLink.href}
              className="flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-primary"
            >
              <shopLink.icon className="size-4" />
              {shopLink.label}
            </Link>
          ) : (
            <span />
          )}

          <div className="flex items-center gap-3">
            <ThemeToggle />
            <LocaleSwitcher />
            {accountCluster}
          </div>
        </Container>
      </div>

      {/* Hàng chính — desktop: logo + điều hướng + (TODO search/giỏ hàng).
          Mobile: logo + cụm tài khoản + nút menu (mở Sheet). */}
      <Container className="flex h-14 items-center gap-3">
        <Link href="/" className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          <ChotMark className="size-7 shrink-0" />
          {/* An duoi 420px: do bang Playwright (390/375/360, Guest va da
              dang nhap) cho thay ca cum nut ben phai deu tran ngang o
              ≤375px neu giu wordmark "Chot" - icon ChotMark da du nhan
              dien thuong hieu khi khong con cho. */}
          <span className="font-semibold whitespace-nowrap text-brand max-[420px]:hidden">
            {t('siteName')}
          </span>
        </Link>

        <nav className="hidden items-center gap-4 md:flex">
          <Link
            href="/products"
            className="text-sm font-medium text-foreground transition-colors hover:text-primary"
          >
            {t('productsLink')}
          </Link>
        </nav>

        {/* TODO: thanh search (Tuần 5) — chiếm khoảng giữa linh hoạt này,
            đặt giữa điều hướng và giỏ hàng/cụm tài khoản. */}
        <div className="flex-1" />

        {/* TODO: icon/nút giỏ hàng (Tuần 6) — đặt ngay trước cụm dưới đây. */}

        {/* Cụm tài khoản — chỉ hiện ở mobile (desktop đã có ở thanh trên). */}
        <div className="flex items-center gap-1.5 md:hidden">{accountCluster}</div>

        {/* Nút menu mobile — mở Sheet chứa điều hướng + ThemeToggle +
            LocaleSwitcher (đang nằm ở thanh trên, ẩn trên mobile). */}
        <Sheet>
          <SheetTrigger
            render={<Button type="button" variant="ghost" size="icon" className="md:hidden" />}
          >
            <Menu />
            <span className="sr-only">{t('openMenu')}</span>
          </SheetTrigger>
          <SheetContent side="left" className="w-64">
            <SheetHeader>
              <SheetTitle>{t('menuTitle')}</SheetTitle>
            </SheetHeader>
            <nav className="flex flex-col gap-1 px-4">
              <SheetClose
                render={<Link href="/products" />}
                className="rounded-lg px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
              >
                {t('productsLink')}
              </SheetClose>
              {shopLink && (
                <SheetClose
                  render={<Link href={shopLink.href} />}
                  className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
                >
                  <shopLink.icon className="size-4" />
                  {shopLink.label}
                </SheetClose>
              )}
            </nav>
            <div className="mt-auto flex items-center gap-2 border-t border-border p-4">
              <ThemeToggle />
              <LocaleSwitcher />
            </div>
          </SheetContent>
        </Sheet>
      </Container>
    </header>
  );
}
