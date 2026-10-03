'use client';

import { use } from 'react';

import {
  SellerOrderListSkeleton,
  SellerOrdersContainer,
  parseSellerOrdersPageQuery,
} from '@/modules/order';
import { Skeleton } from '@/shared/components/ui/skeleton';

import { SellerShopGate } from '../_components/SellerShopGate';

interface SellerOrdersPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

// Composition root: SellerShopGate resolve "shop của tôi" (modules/shop) rồi truyền shopId xuống
// container của modules/order — 2 module không cross-import nhau (rules/general.md mục 1). Tự động
// được bảo vệ đăng nhập vì nằm dưới prefix /seller ở proxy.ts. Là Client Component (cổng cần
// useMyShop) nên đọc `?tab=&page=` bằng `use(searchParams)` — cách Next.js dành cho Client Component
// page, không dùng useSearchParams().
export default function SellerOrdersPage({ searchParams }: SellerOrdersPageProps) {
  const { tab, page } = parseSellerOrdersPageQuery(use(searchParams));

  return (
    <SellerShopGate
      skeleton={
        <>
          <div aria-hidden="true" className="flex flex-wrap items-center justify-between gap-3">
            <Skeleton className="h-7 w-48 motion-reduce:animate-none" />
            <Skeleton className="h-4 w-32 motion-reduce:animate-none" />
          </div>
          <div aria-hidden="true" className="flex gap-1 border-b border-border">
            <Skeleton className="mb-2 h-7 w-full max-w-md motion-reduce:animate-none" />
          </div>
          <SellerOrderListSkeleton />
        </>
      }
    >
      {(shopId) => <SellerOrdersContainer shopId={shopId} tab={tab} page={page} />}
    </SellerShopGate>
  );
}
