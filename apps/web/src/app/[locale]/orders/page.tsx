import { getTranslations } from 'next-intl/server';

import { OrdersContainer, parseOrdersPageQuery } from '@/modules/order';
import { Container } from '@/shared/components/Container';

interface OrdersPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

// Server Component — đọc `?tab=&page=` qua prop searchParams (không dùng useSearchParams(), đúng
// rules/frontend.md mục 2); param sai dạng rơi về mặc định, không làm sập trang. Danh sách đơn là
// dữ liệu cá nhân hoá theo session nên lấy phía client trong OrdersContainer (TanStack Query),
// giống /wishlist. Bảo vệ đăng nhập ở proxy.ts (PROTECTED_PATH_PREFIXES), không tự kiểm tra lại ở
// đây.
export default async function OrdersPage({ searchParams }: OrdersPageProps) {
  const [rawParams, t] = await Promise.all([searchParams, getTranslations('order')]);
  const { tab, page } = parseOrdersPageQuery(rawParams);

  return (
    <div className="flex flex-1 flex-col">
      <main className="flex flex-1 flex-col">
        <Container className="flex flex-1 flex-col gap-6 py-10">
          <h1 className="text-xl font-semibold text-foreground">{t('listPageTitle')}</h1>
          <OrdersContainer tab={tab} page={page} />
        </Container>
      </main>
    </div>
  );
}
