'use client';

import { ArrowLeft } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { use } from 'react';
import { z } from 'zod';

import { Link } from '@/i18n/navigation';
import { OrderDetailSkeleton, SellerOrderDetailContainer } from '@/modules/order';
import { Skeleton } from '@/shared/components/ui/skeleton';

import { SellerShopGate } from '../../_components/SellerShopGate';

interface SellerOrderDetailPageProps {
  params: Promise<{ id: string }>;
}

const orderIdSchema = z.string().uuid();

// Composition root giống /seller/orders: SellerShopGate resolve "shop của tôi" rồi truyền shopId
// xuống container của modules/order. Là Client Component nên đọc route param bằng `use(params)`;
// id kiểm dạng UUID trước khi dùng (id sai dạng không bao giờ được ghép vào đường dẫn gọi API,
// container hiện "không tìm thấy"). Bảo vệ đăng nhập nhờ prefix /seller ở proxy.ts. Quyền xem đơn
// do BE quyết định: đơn của shop khác/đơn chưa thanh toán đều trả 404, giao diện không phân biệt.
export default function SellerOrderDetailPage({ params }: SellerOrderDetailPageProps) {
  const t = useTranslations('order');
  const { id } = use(params);
  const parsedId = orderIdSchema.safeParse(id);

  const heading = (
    <>
      <Link
        href="/seller/orders"
        className="inline-flex min-h-9 w-fit items-center gap-1 rounded-md text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        {t('sellerDetailBackToList')}
      </Link>
      <h1 className="text-xl font-semibold text-foreground">{t('detailPageTitle')}</h1>
    </>
  );

  return (
    <SellerShopGate
      skeleton={
        <>
          <div aria-hidden="true" className="flex flex-col gap-4">
            <Skeleton className="h-5 w-36 motion-reduce:animate-none" />
            <Skeleton className="h-7 w-48 motion-reduce:animate-none" />
          </div>
          <OrderDetailSkeleton />
        </>
      }
    >
      {(shopId) => (
        <div className="flex flex-col gap-4">
          {heading}
          <SellerOrderDetailContainer
            shopId={shopId}
            orderId={parsedId.success ? parsedId.data : null}
          />
        </div>
      )}
    </SellerShopGate>
  );
}
