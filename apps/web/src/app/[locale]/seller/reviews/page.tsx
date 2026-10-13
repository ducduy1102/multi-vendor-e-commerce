'use client';

import { use } from 'react';

import {
  SellerReviewsContainer,
  SellerReviewsSkeleton,
  parseSellerReviewsPageQuery,
} from '@/modules/review';
import { Skeleton } from '@/shared/components/ui/skeleton';

import { SellerShopGate } from '../_components/SellerShopGate';

interface SellerReviewsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

// Composition root giống /seller/orders: SellerShopGate resolve "shop của tôi" (modules/shop) rồi truyền shopId
// xuống container của modules/review — 2 module không cross-import nhau (rules/general.md mục 1). Tự động được bảo
// vệ đăng nhập vì nằm dưới prefix /seller ở proxy.ts. Là Client Component (cổng cần useMyShop) nên đọc
// `?replied=&rating=&page=` bằng `use(searchParams)` — cách Next.js dành cho Client Component page, không dùng
// useSearchParams().
export default function SellerReviewsPage({ searchParams }: SellerReviewsPageProps) {
  const query = parseSellerReviewsPageQuery(use(searchParams));

  return (
    <SellerShopGate
      skeleton={
        <>
          <div aria-hidden="true" className="flex flex-wrap items-center justify-between gap-3">
            <Skeleton className="h-7 w-56 motion-reduce:animate-none" />
            <Skeleton className="h-4 w-32 motion-reduce:animate-none" />
          </div>
          <div aria-hidden="true" className="flex gap-1 border-b border-border">
            <Skeleton className="mb-2 h-7 w-full max-w-sm motion-reduce:animate-none" />
          </div>
          <SellerReviewsSkeleton />
        </>
      }
    >
      {(shopId) => <SellerReviewsContainer shopId={shopId} query={query} />}
    </SellerShopGate>
  );
}
