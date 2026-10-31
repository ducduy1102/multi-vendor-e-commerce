import { getTranslations } from 'next-intl/server';

import { AdminReportsContainer, parseAdminReportsPageQuery } from '@/modules/admin';

interface AdminReportsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

// Server Component — đọc `?status=&type=&page=` qua prop searchParams (không dùng useSearchParams(), đúng rules/frontend.md mục 2); param
// sai dạng rơi về mặc định (tab chờ xử lý, mọi loại, trang 1), không làm sập trang. Hàng đợi báo cáo là dữ liệu quản trị theo session nên lấy
// phía client trong AdminReportsContainer (TanStack Query), giống /admin/appeals. Khung (nav, <main>, Container) do admin/layout.tsx lo;
// chặn người không phải ADMIN ở proxy.ts (/admin/* — role đọc từ JWT, chỉ để điều hướng) và quyền thật ở RolesGuard của BE; không tự kiểm
// tra lại ở đây. Thông báo REPORT_NEW của Admin dẫn tới trang này.
export default async function AdminReportsPage({ searchParams }: AdminReportsPageProps) {
  const [rawParams, t] = await Promise.all([searchParams, getTranslations('admin')]);
  const { status, targetType, page } = parseAdminReportsPageQuery(rawParams);

  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold text-foreground">{t('reportsPageTitle')}</h1>
        <p className="text-sm text-muted-foreground">{t('reportsPageDescription')}</p>
      </div>
      <AdminReportsContainer status={status} targetType={targetType} page={page} />
    </>
  );
}
