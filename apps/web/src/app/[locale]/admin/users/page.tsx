import { getTranslations } from 'next-intl/server';

import { AdminUsersContainer, parseAdminUsersPageQuery } from '@/modules/admin';

interface AdminUsersPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

// Server Component — đọc `?status=&role=&q=&page=&u=` qua prop searchParams (không dùng useSearchParams(), đúng
// rules/frontend.md mục 2); param sai dạng rơi về "không lọc", không làm sập trang. Danh sách người dùng là dữ liệu quản trị
// theo session nên lấy phía client trong AdminUsersContainer (TanStack Query), giống /admin/shops. Khung (nav, <main>,
// Container) do admin/layout.tsx lo; chặn người không phải ADMIN ở proxy.ts (/admin/* — role đọc từ JWT, chỉ để điều hướng)
// và quyền thật ở RolesGuard của BE; không tự kiểm tra lại ở đây.
export default async function AdminUsersPage({ searchParams }: AdminUsersPageProps) {
  const [rawParams, t] = await Promise.all([searchParams, getTranslations('admin')]);
  const query = parseAdminUsersPageQuery(rawParams);

  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold text-foreground">{t('usersPageTitle')}</h1>
        <p className="text-sm text-muted-foreground">{t('usersPageDescription')}</p>
      </div>
      <AdminUsersContainer query={query} />
    </>
  );
}
