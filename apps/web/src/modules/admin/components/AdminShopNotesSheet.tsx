'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/shared/components/ui/sheet';

import type { AdminShop } from '../types';
import { ShopLogo } from './ShopLogo';

interface AdminShopNotesSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Shop đang xem ghi chú. Giữ lại cả sau khi đóng để nội dung không đổi giữa chừng lúc chạy hiệu ứng đóng.
  shop: Pick<AdminShop, 'name' | 'slug' | 'logoUrl'>;
  // Phần ghi chú (AdminNotesSection) do Container truyền vào — ngăn không biết hook nào.
  children: ReactNode;
}

// Ngăn bên phải hiện ghi chú nội bộ của MỘT shop, mở từ nút "Ghi chú" ở dòng shop (danh sách duyệt shop). Component THUẦN trình bày.
// Tên và slug do chủ shop tự đặt nên bẻ dòng bằng `overflow-wrap: anywhere` để chuỗi dài không làm ngăn rộng ra.
export function AdminShopNotesSheet({
  open,
  onOpenChange,
  shop,
  children,
}: AdminShopNotesSheetProps) {
  const t = useTranslations('admin');

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-md">
        <div className="flex items-start gap-3 p-4 pr-12">
          <ShopLogo src={shop.logoUrl} />
          <div className="min-w-0">
            <SheetTitle className="[overflow-wrap:anywhere]">{shop.name}</SheetTitle>
            <SheetDescription className="[overflow-wrap:anywhere]">
              {t('notesShopSheetDescription', { slug: shop.slug })}
            </SheetDescription>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-4 pb-4">{children}</div>
      </SheetContent>
    </Sheet>
  );
}
