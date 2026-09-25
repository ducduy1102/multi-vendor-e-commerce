'use client';

import { ChevronDown, Search, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { Link, useRouter, usePathname } from '@/i18n/navigation';
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

// Week5.md Bước 3.5 (desktop) + theo yêu cầu bổ sung sau đó (mobile) — điều
// hướng sang /products?q=... (tái dùng trang danh sách đã có sẵn filter/
// sort/pagination — Bước 3.6 đọc lại `q` từ đó), không tạo trang kết quả
// riêng. Input luôn bắt đầu rỗng (không tự đọc lại `q` hiện tại trên URL
// nếu đang ở /products — Header là component toàn cục, không có sẵn
// searchParams qua props như page.tsx; giữ đơn giản đúng phạm vi roadmap,
// không thêm useSearchParams() chỉ để đồng bộ ngược 1 chiều này).
//
// Desktop: 1 hàng ngang cùng logo/theme/locale/account (w-auto, flex-1 chiếm
// khoảng trống còn lại). Mobile: `w-full` khiến flex item này không đủ chỗ
// nằm cạnh logo trên cùng 1 hàng (Container cha bật `flex-wrap` ở mobile),
// tự động rớt xuống hàng riêng bên dưới — vẫn ĐÚNG 1 component/1 input DOM
// duy nhất cho mọi breakpoint (không render 2 bản JSX riêng theo
// mobile/desktop — đúng rules/frontend.md mục 5, tránh lỗi input bị đúp/mất
// liên kết label khi có ≥2 bản cùng mount).
//
// `type="text"` thay vì `type="search"` — input kiểu search tự có nút "x"
// xoá của trình duyệt (`::-webkit-search-cancel-button`), không style lại
// màu được nhất quán giữa các trình duyệt (Firefox không hỗ trợ tương tự).
// Tự vẽ nút xoá riêng (X, chỉ hiện khi có chữ) để chủ động màu/style.
//
// Bố cục 1 khối viền chung (input thô, không dùng component `Input` — viền/
// nền riêng của nó không hợp khi cần input trong suốt lồng bên trong 1 khối
// viền lớn hơn, giống cách ProductFilterBar.tsx dùng `<select>` thô thay vì
// cố ép primitive có sẵn) — nút search nằm THỤT VÀO BÊN TRONG khối đó (bố
// cục kiểu Shopee, khác Lazada nút dính liền cạnh phải), nền `bg-primary` +
// icon trắng (`text-primary-foreground`) theo yêu cầu — không phải viền
// rỗng như bản đầu.
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
    <form role="search" onSubmit={handleSubmit} className="flex w-full sm:w-auto sm:flex-1">
      <label htmlFor="header-search" className="sr-only">
        {t('searchLabel')}
      </label>
      <div className="flex h-10 w-full items-center gap-1 rounded-lg border border-input bg-transparent pr-1 pl-3 transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30">
        <input
          id="header-search"
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('searchPlaceholder')}
          className="h-full min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground md:text-sm"
        />
        {query ? (
          <button
            type="button"
            onClick={() => setQuery('')}
            aria-label={t('searchClearLabel')}
            className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <X className="size-4" />
          </button>
        ) : null}
        <button
          type="submit"
          aria-label={t('searchSubmitLabel')}
          className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md bg-primary text-primary-foreground transition-colors outline-none hover:bg-primary/80 focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <Search className="size-4" />
        </button>
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
      <div className="h-8 w-16 animate-pulse rounded-lg motion-reduce:animate-none bg-muted sm:w-20" />
      <div className="h-8 w-16 animate-pulse rounded-lg motion-reduce:animate-none bg-muted sm:w-20" />
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
            giữ nguyên trong messages/*.json) khi có trang "tài khoản tổng"
            thật để trỏ tới. Week5.md Bước 1.13/3.8: Wishlist (Tuần 5) đã
            xong nhưng cố tình làm route RIÊNG (/wishlist, không có link nào
            trỏ tới từ đây) — "Trang cá nhân" chỉ đáng bật lại khi có thêm
            "Đơn hàng của tôi" (Tuần 8) để gộp chung thành 1 trang tài khoản
            thật sự. Ẩn tạm vì trỏ "/" không có đích thật, dễ gây hiểu nhầm
            là bug. */}
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
      {/* Mobile (< sm): logo hàng 1, search hàng 2 (Container bật flex-wrap,
          HeaderSearchForm w-full khiến nó không đủ chỗ nằm cạnh logo nên tự
          rớt xuống dòng — xem comment ở HeaderSearchForm). ThemeToggle/
          LocaleSwitcher/cụm tài khoản vẫn KHÔNG hiện ở mobile (đã chuyển hết
          vào BottomTabBar/AccountSheet, shared/components/BottomTabBar.tsx,
          AccountSheet.tsx) — chỉ riêng search là ngoại lệ mới. Desktop (>= sm,
          khớp breakpoint BottomTabBar ẩn đi): 1 hàng duy nhất — trái logo,
          giữa search (flex-1), phải ThemeToggle/LocaleSwitcher/cụm tài khoản.
          Nav ngang hàng "Sản phẩm"/"Kênh người bán" đã bỏ (theo yêu cầu) —
          vào /products qua thanh search hoặc trang chủ, vào khu seller qua
          dropdown tài khoản (shopLink vẫn còn ở đó). */}
      <Container className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2 sm:h-14 sm:flex-nowrap sm:py-0">
        <Link href="/" className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          <ChotMark className="size-8 shrink-0" />
          <span className="text-lg font-semibold whitespace-nowrap text-brand">
            {t('siteName')}
          </span>
        </Link>

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
