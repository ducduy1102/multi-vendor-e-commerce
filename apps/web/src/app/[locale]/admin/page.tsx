import { getTranslations } from 'next-intl/server';

import { AdminOverviewContainer } from '@/modules/admin';

// Server Component — chỉ ghép tiêu đề (dịch phía server) với khối "việc cần xử lý". Số đếm là dữ liệu quản trị theo
// session nên lấy phía client trong AdminOverviewContainer (TanStack Query, cùng query với nav), giống /admin/shops.
// Khung (nav, <main>, Container) do layout.tsx lo.
export default async function AdminOverviewPage() {
  const t = await getTranslations('admin');

  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold text-foreground">{t('overviewPageTitle')}</h1>
        <p className="text-sm text-muted-foreground">{t('overviewPageDescription')}</p>
      </div>
      <AdminOverviewContainer />
    </>
  );
}
