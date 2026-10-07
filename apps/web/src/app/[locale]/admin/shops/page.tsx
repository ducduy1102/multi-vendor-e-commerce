import { getTranslations } from 'next-intl/server';

import { AdminShopsContainer, parseAdminShopsPageQuery } from '@/modules/admin';
import { Container } from '@/shared/components/Container';

interface AdminShopsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

// Server Component — đọc `?status=&page=` qua prop searchParams (không dùng useSearchParams(), đúng
// rules/frontend.md mục 2); param sai dạng rơi về mặc định (hàng chờ duyệt, trang 1), không làm sập
// trang. Danh sách shop là dữ liệu quản trị theo session nên lấy phía client trong
// AdminShopsContainer (TanStack Query), giống /orders. Chặn người không phải ADMIN ở proxy.ts
// (/admin/* — role đọc từ JWT, chỉ để điều hướng) và quyền thật ở RolesGuard của BE; không tự kiểm
// tra lại ở đây.
export default async function AdminShopsPage({ searchParams }: AdminShopsPageProps) {
  const [rawParams, t] = await Promise.all([searchParams, getTranslations('admin')]);
  const { status, page } = parseAdminShopsPageQuery(rawParams);

  return (
    <div className="flex flex-1 flex-col">
      <main className="flex flex-1 flex-col">
        <Container className="flex flex-1 flex-col gap-6 py-10">
          <div className="flex flex-col gap-1">
            <h1 className="text-xl font-semibold text-foreground">{t('pageTitle')}</h1>
            <p className="text-sm text-muted-foreground">{t('pageDescription')}</p>
          </div>
          <AdminShopsContainer status={status} page={page} />
        </Container>
      </main>
    </div>
  );
}
