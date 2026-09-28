'use client';

import { Home, LayoutGrid, ShoppingCart } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Link, usePathname } from '@/i18n/navigation';
import { CartCountBadge, useCartCount } from '@/modules/cart';
import { AccountSheet } from '@/shared/components/AccountSheet';
import { HIDDEN_CHROME_PATHS } from '@/shared/lib/hidden-chrome-paths';
import { cn } from '@/shared/lib/utils';

// Padding-bottom đủ chỗ cho nội dung trang không bị BottomTabBar (dưới đây)
// che khuất — height thật của tab bar là `h-14` (3.5rem) + safe-area-inset
// (tai thỏ/home indicator). Chỉ hiệu lực < sm, khớp `sm:hidden` của chính
// tab bar.
const MOBILE_TAB_BAR_SPACER_CLASS = 'pb-[calc(3.5rem+env(safe-area-inset-bottom,0px))] sm:pb-0';

// Bọc {children} ở app/[locale]/layout.tsx — cùng 1 nơi quyết định pathname
// nào ẩn tab bar (HIDDEN_CHROME_PATHS) để không thừa padding-bottom trên
// /login, /register (lệch tâm card đăng nhập trên mobile nếu áp nhầm).
// Là Client Component (cần usePathname) — layout.tsx giữ nguyên Server
// Component, chỉ import component này.
export function MobileTabBarSpacer({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isChromeHidden = HIDDEN_CHROME_PATHS.includes(pathname);

  return (
    <div className={cn('flex flex-1 flex-col', !isChromeHidden && MOBILE_TAB_BAR_SPACER_CLASS)}>
      {children}
    </div>
  );
}

const TAB_ITEM_CLASS =
  'flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-medium transition-colors';

function tabItemClass(isActive: boolean) {
  return cn(
    TAB_ITEM_CLASS,
    isActive ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
  );
}

// Thay cho Sheet hamburger cũ (chỉ mobile, < sm — desktop giữ nguyên nav +
// dropdown tài khoản trong Header.tsx). Layout 4 cột chia đều (justify-around
// qua flex-1 từng item): Trang chủ, Sản phẩm, Giỏ hàng (Tuần 6), Tài khoản —
// thêm tab Giỏ hàng chỉ bằng 1 item cùng tabItemClass, không đổi cấu trúc.
export function BottomTabBar() {
  const t = useTranslations('header');
  const tCart = useTranslations('cart');
  const pathname = usePathname();
  // Hook phải chạy TRƯỚC early return bên dưới (Rules of Hooks).
  const cartCount = useCartCount();

  // Trang đăng nhập/đăng ký tự có layout riêng, không cần điều hướng — cùng
  // lý do Header ẩn ở đây (xem HIDDEN_CHROME_PATHS).
  if (HIDDEN_CHROME_PATHS.includes(pathname)) {
    return null;
  }

  const isHomeActive = pathname === '/';
  const isProductsActive = pathname === '/products' || pathname.startsWith('/products/');
  const isCartActive = pathname === '/cart';

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background sm:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      aria-label={t('mobileNavLabel')}
    >
      <div className="flex h-14 items-stretch justify-around">
        <Link
          href="/"
          aria-current={isHomeActive ? 'page' : undefined}
          className={tabItemClass(isHomeActive)}
        >
          <Home className="size-5" aria-hidden="true" />
          {t('homeLink')}
        </Link>
        <Link
          href="/products"
          aria-current={isProductsActive ? 'page' : undefined}
          className={tabItemClass(isProductsActive)}
        >
          <LayoutGrid className="size-5" aria-hidden="true" />
          {t('productsLink')}
        </Link>
        <Link
          href="/cart"
          aria-current={isCartActive ? 'page' : undefined}
          className={tabItemClass(isCartActive)}
        >
          <span className="relative flex">
            <ShoppingCart className="size-5" aria-hidden="true" />
            <CartCountBadge count={cartCount} />
          </span>
          {t('cartLink')}
          {cartCount ? (
            <span className="sr-only">{tCart('itemsCount', { count: cartCount })}</span>
          ) : null}
        </Link>
        <AccountSheet triggerClassName={tabItemClass(false)} />
      </div>
    </nav>
  );
}
