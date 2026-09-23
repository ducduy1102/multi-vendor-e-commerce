'use client';

import { ChevronDown, Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { Link, useRouter, usePathname } from '@/i18n/navigation';
import { LogoutButton, useAuthStore } from '@/modules/auth';
import { ChotMark } from '@/shared/components/ChotMark';
import { Container } from '@/shared/components/Container';
import { Button } from '@/shared/components/ui/button';
import { Input } from '@/shared/components/ui/input';
import { useSellerChannelLink } from '@/shared/hooks/useSellerChannelLink';
import { HIDDEN_CHROME_PATHS } from '@/shared/lib/hidden-chrome-paths';
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

// Export — AccountSheet (shared/components/AccountSheet.tsx, Sheet mobile)
// dùng lại đúng cách hiển thị avatar này, tránh lặp initialsFromName() ở 2 nơi.
export function UserAvatar({ name }: { name: string }) {
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

// Week5.md Bước 3.5 — chiếm đúng khoảng trống đã chừa sẵn ở 1.10
// (Header.tsx:170-172 cũ, placeholder <div className="flex-1" />). Điều
// hướng sang /products?q=... (tái dùng trang danh sách đã có sẵn filter/
// sort/pagination — Bước 3.6 đọc lại `q` từ đó), không tạo trang kết quả
// riêng. Input luôn bắt đầu rỗng (không tự đọc lại `q` hiện tại trên URL
// nếu đang ở /products — Header là component toàn cục, không có sẵn
// searchParams qua props như page.tsx; giữ đơn giản đúng phạm vi roadmap,
// không thêm useSearchParams() chỉ để đồng bộ ngược 1 chiều này).
function HeaderSearchForm() {
  const t = useTranslations('header');
  const router = useRouter();
  const [query, setQuery] = useState('');

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = query.trim();
    router.push({ pathname: '/products', query: trimmed ? { q: trimmed } : {} });
  }

  return (
    <form role="search" onSubmit={handleSubmit} className="hidden flex-1 sm:flex sm:max-w-sm">
      <label htmlFor="header-search" className="sr-only">
        {t('searchLabel')}
      </label>
      <div className="relative w-full">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          id="header-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('searchPlaceholder')}
          className="pl-8"
        />
      </div>
    </form>
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

  // href/icon/label (guest -> onboarding, có shop -> quản lý sản phẩm...)
  // dùng chung với AccountSheet.tsx qua đúng 1 hook — useSellerChannelLink
  // tự tính sẵn label (namespace 'header'), không tự lặp lại điều kiện
  // hasShop ? myProductsLink : becomeSellerLink ở đây nữa.
  const shopLink = useSellerChannelLink();

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
      {/* Mobile (< sm): chỉ còn logo — điều hướng, ThemeToggle, LocaleSwitcher
          và cụm tài khoản đã chuyển hết vào BottomTabBar/AccountSheet
          (shared/components/BottomTabBar.tsx, AccountSheet.tsx). Desktop
          (>= sm, khớp breakpoint BottomTabBar ẩn đi — trước đây header dùng
          md: cho các cụm này, để hở khoảng 640-768px không có điều hướng
          nào cả sau khi bỏ hamburger, nay đổi về sm: cho khớp): trái — logo +
          điều hướng ngang hàng ("Sản phẩm", "Kênh người bán"); phải —
          ThemeToggle, LocaleSwitcher, cụm tài khoản. */}
      <Container className="flex h-14 items-center gap-3">
        <Link href="/" className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          <ChotMark className="size-7 shrink-0" />
          <span className="font-semibold whitespace-nowrap text-brand">{t('siteName')}</span>
        </Link>

        {/* sm:ml-4 — cách logo 1 khoảng rõ ràng, không dính sát. */}
        <nav className="hidden items-center gap-4 sm:ml-4 sm:flex">
          <HeaderNavLink href="/products">{t('productsLink')}</HeaderNavLink>
          {shopLink && <HeaderNavLink href={shopLink.href}>{shopLink.label}</HeaderNavLink>}
        </nav>

        <HeaderSearchForm />

        {/* TODO: icon/nút giỏ hàng (Tuần 6) — đặt ngay trước cụm dưới đây. */}

        <div className="hidden items-center gap-3 sm:flex">
          <ThemeToggle />
          <LocaleSwitcher />
        </div>

        <div className="hidden sm:flex">{accountCluster}</div>
      </Container>
    </header>
  );
}
