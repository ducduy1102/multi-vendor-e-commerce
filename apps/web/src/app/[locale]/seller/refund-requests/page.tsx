'use client';

import { use } from 'react';

import {
  SellerRefundRequestsContainer,
  SellerRefundRequestsSkeleton,
  parseSellerRefundRequestsPageQuery,
} from '@/modules/order';
import { Skeleton } from '@/shared/components/ui/skeleton';

import { SellerShopGate } from '../_components/SellerShopGate';

interface SellerRefundRequestsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

// Composition root giống /seller/orders: SellerShopGate resolve "shop của tôi" (modules/shop) rồi truyền shopId
// xuống container của modules/order — 2 module không cross-import nhau (rules/general.md mục 1). Tự động được bảo
// vệ đăng nhập vì nằm dưới prefix /seller ở proxy.ts. Là Client Component (cổng cần useMyShop) nên đọc
// `?status=&page=` bằng `use(searchParams)` — cách Next.js dành cho Client Component page, không dùng
// useSearchParams().
export default function SellerRefundRequestsPage({ searchParams }: SellerRefundRequestsPageProps) {
  const { filter, page } = parseSellerRefundRequestsPageQuery(use(searchParams));

  return (
    <SellerShopGate
      skeleton={
        <>
          <div aria-hidden="true" className="flex flex-wrap items-center justify-between gap-3">
            <Skeleton className="h-7 w-56 motion-reduce:animate-none" />
            <Skeleton className="h-4 w-40 motion-reduce:animate-none" />
          </div>
          <div aria-hidden="true" className="flex gap-1 border-b border-border">
            <Skeleton className="mb-2 h-7 w-full max-w-md motion-reduce:animate-none" />
          </div>
          <SellerRefundRequestsSkeleton />
        </>
      }
    >
      {(shopId) => <SellerRefundRequestsContainer shopId={shopId} filter={filter} page={page} />}
    </SellerShopGate>
  );
}
