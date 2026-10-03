'use client';

import { useTranslations } from 'next-intl';
import { use, useEffect } from 'react';

import { useRouter } from '@/i18n/navigation';
import {
  SellerOrderListSkeleton,
  SellerOrdersContainer,
  parseSellerOrdersPageQuery,
} from '@/modules/order';
import { useMyShop } from '@/modules/shop';
import { Skeleton } from '@/shared/components/ui/skeleton';

interface SellerOrdersPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

// Composition root giống seller/products/page.tsx: trang cần biết "shop của user hiện tại"
// (modules/shop) để quản lý đơn (modules/order) — 2 module không được cross-import lẫn nhau
// (rules/general.md mục 1) nên phần ghép nối nằm ở app/. Tự động được bảo vệ đăng nhập vì nằm dưới
// prefix /seller ở proxy.ts. Là Client Component (cần useMyShop) nên đọc `?tab=&page=` bằng
// `use(searchParams)` — cách Next.js dành cho Client Component page, không dùng useSearchParams().
export default function SellerOrdersPage({ searchParams }: SellerOrdersPageProps) {
  const t = useTranslations('shop');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const myShopQuery = useMyShop();
  const { tab, page } = parseSellerOrdersPageQuery(use(searchParams));

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
          <div aria-hidden="true" className="flex flex-wrap items-center justify-between gap-3">
            <Skeleton className="h-7 w-48 motion-reduce:animate-none" />
            <Skeleton className="h-4 w-32 motion-reduce:animate-none" />
          </div>
          <div aria-hidden="true" className="flex gap-1 border-b border-border">
            <Skeleton className="mb-2 h-7 w-full max-w-md motion-reduce:animate-none" />
          </div>
          <SellerOrderListSkeleton />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl flex-1 px-4 py-16">
      <SellerOrdersContainer shopId={myShopQuery.data.id} tab={tab} page={page} />
    </div>
  );
}
