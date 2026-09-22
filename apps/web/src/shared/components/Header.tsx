'use client';

import { ChevronDown, Menu } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Link, usePathname } from '@/i18n/navigation';
import { LogoutButton, useAuthStore } from '@/modules/auth';
import { ChotMark } from '@/shared/components/ChotMark';
import { Container } from '@/shared/components/Container';
import { Button } from '@/shared/components/ui/button';
import { useSellerChannelLink } from '@/shared/hooks/useSellerChannelLink';
import { HIDDEN_CHROME_PATHS } from '@/shared/lib/hidden-chrome-paths';
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

// 1 component dùng chung cho cả 2 mục điều hướng ngang hàng ("Sản phẩm",
// "Kênh người bán") — đảm bảo cùng kiểu chữ/hover, không lặp lại className
// ở 2 nơi rồi lệch nhau khi sửa sau này.
function HeaderNavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="text-sm font-medium text-foreground transition-colors hover:text-primary"
    >
      {children}
    </Link>
  );
}

// Header là app-chrome hiển thị ở MỌI trang (không thuộc riêng 1 route/
// feature cụ thể) — khác pattern "composition root ở app/<route>/page.tsx"
// đã dùng cho product+shop (Week4.md Bước 3.6), Header cần đọc CẢ
// useAuthStore (modules/auth, trực tiếp) lẫn useMyShop (modules/shop, qua
// useSellerChannelLink) để quyết định nội dung dropdown tài khoản. Đặt ở
// shared/ (không thuộc module nào) — cùng tinh thần ngoại lệ "hook dùng
// chung ≥ 2 module" đã áp dụng cho useAuthStore ở modules/shop
// (rules/general.md mục 1).
export function Header() {
  const t = useTranslations('header');
  const tAuth = useTranslations('auth');
  const pathname = usePathname();
  const user = useAuthStore((state) => state.user);
  const isHydrating = useAuthStore((state) => state.isHydrating);

  // Logic href/icon (guest -> onboarding, có shop -> quản lý sản phẩm...)
  // giờ dùng chung với HomeBanner (shared/hooks/useSellerChannelLink.ts) —
  // ở đây chỉ còn gắn thêm label theo ngữ cảnh Header (dropdown/nav ngang
  // hàng/Sheet đều dùng "Trở thành người bán"/"Sản phẩm của tôi", khác chữ
  // cố định "Bán hàng cùng Chốt" của banner).
  const sellerChannel = useSellerChannelLink();
  const shopLink = sellerChannel && {
    href: sellerChannel.href,
    icon: sellerChannel.icon,
    label: sellerChannel.hasShop ? t('myProductsLink') : t('becomeSellerLink'),
  };

  // Đặt SAU mọi hook (Rules of Hooks — không được return sớm trước khi các
  // hook ở trên đã chạy đủ, dù trang này thường chưa đăng nhập nên
  // useMyShop() cũng đang disabled, không tốn request thật nào).
  if (HIDDEN_CHROME_PATHS.includes(pathname)) {
    return null;
  }

  // 1 nguồn duy nhất cho trạng thái Guest/loading/đã đăng nhập — Header giờ
  // chỉ còn 1 hàng nên cụm này chỉ render 1 lần duy nhất (trước đó có bản
  // 2 tầng, phải render 2 lần ở 2 vị trí ẩn/hiện theo breakpoint).
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
      {/* 1 hàng duy nhất (bản 2 tầng trước đó mất cân đối vì thanh trên chỉ
          có 1 link) — trái: logo + điều hướng ngang hàng ("Sản phẩm",
          "Kênh người bán"). Phải: ThemeToggle, LocaleSwitcher (ẩn ở mobile,
          chuyển vào Sheet), cụm tài khoản (luôn hiện, cả mobile lẫn
          desktop), nút menu (chỉ mobile). */}
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

        {/* md:ml-4 — cách logo 1 khoảng rõ ràng, không dính sát. */}
        <nav className="hidden items-center gap-4 md:ml-4 md:flex">
          <HeaderNavLink href="/products">{t('productsLink')}</HeaderNavLink>
          {shopLink && <HeaderNavLink href={shopLink.href}>{shopLink.label}</HeaderNavLink>}
        </nav>

        {/* TODO: thanh search (Tuần 5) — chiếm khoảng giữa linh hoạt này,
            đặt giữa điều hướng và giỏ hàng/ThemeToggle/LocaleSwitcher. */}
        <div className="flex-1" />

        {/* TODO: icon/nút giỏ hàng (Tuần 6) — đặt ngay trước cụm dưới đây. */}

        {/* ThemeToggle/LocaleSwitcher — chỉ desktop, mobile chuyển vào Sheet. */}
        <div className="hidden items-center gap-3 md:flex">
          <ThemeToggle />
          <LocaleSwitcher />
        </div>

        {accountCluster}

        {/* Nút menu mobile — mở Sheet chứa điều hướng + ThemeToggle +
            LocaleSwitcher (ẩn trên mobile ở trên). */}
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
