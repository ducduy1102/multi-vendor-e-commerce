'use client';

import { useTranslations } from 'next-intl';
import { useEffect, type ReactNode } from 'react';

import { useRouter } from '@/i18n/navigation';
import { useMyShop } from '@/modules/shop';

interface SellerShopGateProps {
  // Hiện trong lúc đang tải "shop của tôi" — nên khớp bố cục của nội dung thật.
  skeleton: ReactNode;
  // Chỉ được render khi đã có shop.
  children: (shopId: string) => ReactNode;
}

// Cổng "shop của tôi" cho các trang trong khu seller: trang cần biết shop của user hiện tại
// (modules/shop) để quản lý dữ liệu của module khác (đơn hàng...) — hai module không được
// cross-import nhau (rules/general.md mục 1) nên phần ghép nối nằm ở app/ (composition root).
// Xử lý đủ 3 nhánh: đang tải (skeleton, aria-busy + dòng sr-only), lỗi (thông báo), chưa có shop
// (chuyển sang /seller/onboarding). Thư mục `_components` là private folder của Next.js (không thành
// route). Dùng cho các trang seller rộng `max-w-5xl` (products, vouchers, orders, orders/[id]); trang
// products/new hẹp hơn (`max-w-3xl`) và chỉ hiện chữ "Đang tải" nên chưa dùng cổng này.
export function SellerShopGate({ skeleton, children }: SellerShopGateProps) {
  const t = useTranslations('shop');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const myShopQuery = useMyShop();

  useEffect(() => {
    if (myShopQuery.isSuccess && !myShopQuery.data) {
      router.push('/seller/onboarding');
    }
  }, [myShopQuery.isSuccess, myShopQuery.data, router]);

  if (myShopQuery.isPending || !myShopQuery.data) {
    if (myShopQuery.isError) {
      return (
        <div className="mx-auto w-full max-w-5xl flex-1 px-4 py-16">
          <p role="alert" className="text-sm text-destructive">
            {t('loadShopError')}
          </p>
        </div>
      );
    }
    return (
      <div className="mx-auto w-full max-w-5xl flex-1 px-4 py-16">
        <div aria-busy="true" className="flex flex-col gap-6">
          <span className="sr-only">{tCommon('loading')}</span>
          {skeleton}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl flex-1 px-4 py-16">
      {children(myShopQuery.data.id)}
    </div>
  );
}
