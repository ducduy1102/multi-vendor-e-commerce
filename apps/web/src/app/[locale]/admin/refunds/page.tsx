import { getTranslations } from 'next-intl/server';

import { AdminRefundsContainer, parseAdminRefundsPageQuery } from '@/modules/admin';
import { Container } from '@/shared/components/Container';

interface AdminRefundsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

// Server Component — đọc `?tab=&status=&page=` qua prop searchParams (không dùng useSearchParams(), đúng
// rules/frontend.md mục 2); param sai dạng rơi về mặc định (tab khiếu nại, bộ lọc mặc định của tab, trang 1),
// không làm sập trang. Dữ liệu là dữ liệu quản trị theo session nên lấy phía client trong từng panel (TanStack
// Query), giống /admin/shops. Chặn người không phải ADMIN ở proxy.ts (/admin/* — role đọc từ JWT, chỉ để điều
// hướng) và quyền thật ở RolesGuard của BE; không tự kiểm tra lại ở đây.
export default async function AdminRefundsPage({ searchParams }: AdminRefundsPageProps) {
  const [rawParams, t] = await Promise.all([searchParams, getTranslations('admin')]);
  const query = parseAdminRefundsPageQuery(rawParams);

  return (
    <div className="flex flex-1 flex-col">
      <main className="flex flex-1 flex-col">
        <Container className="flex flex-1 flex-col gap-6 py-10">
          <div className="flex flex-col gap-1">
            <h1 className="text-xl font-semibold text-foreground">{t('refundsPageTitle')}</h1>
            <p className="text-sm text-muted-foreground">{t('refundsPageDescription')}</p>
          </div>
          <AdminRefundsContainer query={query} />
        </Container>
      </main>
    </div>
  );
}
