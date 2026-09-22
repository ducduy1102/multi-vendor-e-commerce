'use client';

import { LogOut, User } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Link } from '@/i18n/navigation';
import { useAuthStore, useLogout } from '@/modules/auth';
import { UserAvatar } from '@/shared/components/Header';
import { Button, buttonVariants } from '@/shared/components/ui/button';
import { Separator } from '@/shared/components/ui/separator';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/shared/components/ui/sheet';
import { useSellerChannelLink } from '@/shared/hooks/useSellerChannelLink';
import { LocaleSwitcher } from './LocaleSwitcher';
import { ThemeToggle } from './ThemeToggle';

interface AccountSheetProps {
  triggerClassName?: string;
}

// Mở từ tab "Tài khoản" của BottomTabBar (shared/components/BottomTabBar.tsx)
// — Sheet duy nhất cho mobile, gộp cả ThemeToggle/LocaleSwitcher (trước ở
// Sheet hamburger cũ) lẫn menu tài khoản (trước ở DropdownMenu desktop của
// Header.tsx). shopLink dùng lại đúng useSellerChannelLink() — cùng nguồn
// với Header.tsx, không tự tính lại href/label riêng.
export function AccountSheet({ triggerClassName }: AccountSheetProps) {
  const t = useTranslations('header');
  const tAuth = useTranslations('auth');
  const user = useAuthStore((state) => state.user);
  const isHydrating = useAuthStore((state) => state.isHydrating);
  const { handleLogout, isLoading: isLoggingOut } = useLogout();

  const sellerChannel = useSellerChannelLink();
  const shopLink = sellerChannel && {
    href: sellerChannel.href,
    icon: sellerChannel.icon,
    label: sellerChannel.hasShop ? t('myProductsLink') : t('becomeSellerLink'),
  };

  return (
    <Sheet>
      <SheetTrigger render={<button type="button" className={triggerClassName} />}>
        {/* Skeleton cùng kích thước icon (size-5) khi đang hydrate — tránh
            nháy sai icon Guest/đã đăng nhập lúc F5 (cùng lý do accountCluster
            của Header.tsx có nhánh isHydrating riêng). */}
        {isHydrating ? (
          <span className="size-5 animate-pulse rounded-full bg-muted" aria-hidden="true" />
        ) : (
          <User className="size-5" />
        )}
        {t('accountTabLabel')}
      </SheetTrigger>
      <SheetContent side="bottom" className="max-h-[80vh]">
        <SheetHeader>
          <SheetTitle>{t('accountTabLabel')}</SheetTitle>
        </SheetHeader>

        <div className="flex flex-col gap-4 px-4 pb-4">
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <LocaleSwitcher />
          </div>

          {isHydrating ? (
            <div className="flex flex-col gap-2" aria-hidden="true">
              <div className="h-9 w-full animate-pulse rounded-lg bg-muted" />
              <div className="h-9 w-full animate-pulse rounded-lg bg-muted" />
            </div>
          ) : !user ? (
            <div className="flex flex-col gap-2">
              <SheetClose
                render={<Link href="/login" />}
                className={buttonVariants({ variant: 'outline', className: 'w-full' })}
              >
                {tAuth('guestLoginLink')}
              </SheetClose>
              <SheetClose
                render={<Link href="/register" />}
                className={buttonVariants({ className: 'w-full' })}
              >
                {tAuth('guestRegisterLink')}
              </SheetClose>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <UserAvatar name={user.name} />
                <span className="truncate text-sm font-medium text-foreground">{user.name}</span>
              </div>

              {shopLink && (
                <SheetClose
                  render={<Link href={shopLink.href} />}
                  className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
                >
                  <shopLink.icon className="size-4" />
                  {shopLink.label}
                </SheetClose>
              )}

              <Separator />

              <Button
                type="button"
                variant="destructive"
                className="w-full justify-start gap-2"
                disabled={isLoggingOut}
                onClick={handleLogout}
              >
                <LogOut />
                {isLoggingOut ? tAuth('logoutSubmitting') : tAuth('logoutSubmit')}
              </Button>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
