import { ArrowLeft } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { z } from 'zod';

import { Link } from '@/i18n/navigation';
import { OrderDetailContainer } from '@/modules/order';
import { Container } from '@/shared/components/Container';

interface OrderDetailPageProps {
  params: Promise<{ id: string }>;
}

const orderIdSchema = z.string().uuid();

// Server Component — chỉ lấy `id` từ route param và kiểm dạng UUID (id sai dạng không bao giờ được
// ghép vào đường dẫn gọi API). Dữ liệu đơn là dữ liệu cá nhân hoá theo session nên lấy phía client
// trong OrderDetailContainer (TanStack Query), giống /orders. Bảo vệ đăng nhập ở proxy.ts
// (tiền tố "/orders" trong PROTECTED_PATH_PREFIXES bao cả /orders/<id>), không tự kiểm tra lại ở đây.
export default async function OrderDetailPage({ params }: OrderDetailPageProps) {
  const [{ id }, t] = await Promise.all([params, getTranslations('order')]);
  const parsedId = orderIdSchema.safeParse(id);

  return (
    <div className="flex flex-1 flex-col">
      <main className="flex flex-1 flex-col">
        <Container className="flex flex-1 flex-col gap-4 py-10">
          <Link
            href="/orders"
            className="inline-flex min-h-9 w-fit items-center gap-1 rounded-md text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            {t('detailBackToList')}
          </Link>
          <h1 className="text-xl font-semibold text-foreground">{t('detailPageTitle')}</h1>
          <OrderDetailContainer orderId={parsedId.success ? parsedId.data : null} />
        </Container>
      </main>
    </div>
  );
}
