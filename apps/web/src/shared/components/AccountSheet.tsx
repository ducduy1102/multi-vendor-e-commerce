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
import { cn } from '@/shared/lib/utils';
import { useUIStore } from '@/shared/store/ui.store';
import { LocaleSwitcher } from './LocaleSwitcher';
import { ThemeToggle } from './ThemeToggle';

interface AccountSheetProps {
  triggerClassName?: string;
}

// Mở từ tab "Tài khoản" của BottomTabBar (shared/components/BottomTabBar.tsx)
// — Sheet duy nhất cho mobile, gộp cả ThemeToggle/LocaleSwitcher (trước ở
// Sheet hamburger cũ) lẫn menu tài khoản (trước ở DropdownMenu desktop của
// Header.tsx). shopLink lấy nguyên từ useSellerChannelLink() (kèm label đã
// dịch sẵn) — cùng 1 hook dùng chung với Header.tsx, không tự tính lại
// href/label riêng ở đây.
export function AccountSheet({ triggerClassName }: AccountSheetProps) {
  const t = useTranslations('header');
  const tAuth = useTranslations('auth');
  const user = useAuthStore((state) => state.user);
  const isHydrating = useAuthStore((state) => state.isHydrating);
  const { handleLogout, isLoading: isLoggingOut } = useLogout();
  const isAccountSheetOpen = useUIStore((state) => state.isAccountSheetOpen);
  const setAccountSheetOpen = useUIStore((state) => state.setAccountSheetOpen);

  const shopLink = useSellerChannelLink();

  return (
    <Sheet open={isAccountSheetOpen} onOpenChange={setAccountSheetOpen}>
      <SheetTrigger render={<button type="button" className={triggerClassName} />}>
        {/* Skeleton cùng kích thước icon (size-5) khi đang hydrate — tránh
            nháy sai icon Guest/đã đăng nhập lúc F5 (cùng lý do accountCluster
            của Header.tsx có nhánh isHydrating riêng). */}
        {isHydrating ? (
          <span
            className="size-5 animate-pulse rounded-full motion-reduce:animate-none bg-muted"
            aria-hidden="true"
          />
        ) : (
          <User className="size-5" aria-hidden="true" />
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
            // Cố định 2 khối cao h-8 (khớp Button size="default" thật) dù
            // nội dung thật sau khi hydrate xong có thể là 2 phần (Guest:
            // Đăng nhập/Đăng ký) hoặc 4 phần khác hẳn (đã đăng nhập: avatar+
            // tên, link shop, Separator, nút Đăng xuất) — ngoại lệ có chủ ý
            // so với "khớp kích thước và bố cục" (rules/frontend.md mục 4
            // UI polish): không biết trước sẽ rơi vào nhánh nào lúc render
            // skeleton, và isHydrating thường rất ngắn nên chấp nhận đổi
            // hình dạng khối (không chỉ đổi kích thước) ở lần hydrate xong.
            <div className="flex flex-col gap-2" aria-hidden="true">
              <div className="h-8 w-full animate-pulse rounded-lg motion-reduce:animate-none bg-muted" />
              <div className="h-8 w-full animate-pulse rounded-lg motion-reduce:animate-none bg-muted" />
            </div>
          ) : !user ? (
            <div className="flex flex-col gap-2">
              <SheetClose
                render={<Link href="/login" />}
                className={cn(buttonVariants({ variant: 'outline' }), 'w-full')}
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
                  <shopLink.icon className="size-4" aria-hidden="true" />
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
                <LogOut aria-hidden="true" />
                {isLoggingOut ? tAuth('logoutSubmitting') : tAuth('logoutSubmit')}
              </Button>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
