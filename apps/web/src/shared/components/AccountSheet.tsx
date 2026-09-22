'use client';

import { User } from 'lucide-react';
import { useTranslations } from 'next-intl';

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/shared/components/ui/sheet';

interface AccountSheetProps {
  triggerClassName?: string;
}

// Mở từ tab "Tài khoản" của BottomTabBar (shared/components/BottomTabBar.tsx).
// STUB — chỉ mở/đóng được, chưa có nội dung thật (ThemeToggle, LocaleSwitcher,
// trạng thái Guest/đã đăng nhập, "Sản phẩm của tôi"/"Kênh người bán", Đăng
// xuất). Nội dung đầy đủ + gỡ Sheet hamburger cũ trong Header.tsx làm ở
// commit kế tiếp — tách riêng để mỗi commit chỉ làm 1 việc.
export function AccountSheet({ triggerClassName }: AccountSheetProps) {
  const t = useTranslations('header');

  return (
    <Sheet>
      <SheetTrigger render={<button type="button" className={triggerClassName} />}>
        <User className="size-5" />
        {t('accountTabLabel')}
      </SheetTrigger>
      <SheetContent side="bottom" className="max-h-[80vh]">
        <SheetHeader>
          <SheetTitle>{t('accountTabLabel')}</SheetTitle>
        </SheetHeader>
      </SheetContent>
    </Sheet>
  );
}
