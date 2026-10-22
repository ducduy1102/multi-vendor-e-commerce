import { getTranslations } from 'next-intl/server';

import { NotificationsContainer, parseNotificationsPageQuery } from '@/modules/notification';
import { Container } from '@/shared/components/Container';

interface NotificationsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

// Hộp thông báo của người đang đăng nhập. Server Component — đọc `?tab=` qua prop searchParams (không dùng
// useSearchParams(), đúng rules/frontend.md mục 2); tab sai dạng rơi về "Tất cả", không làm sập trang. Danh sách là dữ liệu
// cá nhân theo session nên lấy phía client trong NotificationsContainer (TanStack Query + real-time), giống /orders và
// /wishlist. Bảo vệ đăng nhập ở proxy.ts (PROTECTED_PATH_PREFIXES), không tự kiểm tra lại ở đây.
export default async function NotificationsPage({ searchParams }: NotificationsPageProps) {
  const [rawParams, t] = await Promise.all([searchParams, getTranslations('notification')]);
  const { tab } = parseNotificationsPageQuery(rawParams);

  return (
    <div className="flex flex-1 flex-col">
      <main className="flex flex-1 flex-col">
        <Container className="flex max-w-3xl flex-1 flex-col gap-4 py-6 md:py-10">
          <h1 className="text-xl font-semibold text-foreground">{t('pageTitle')}</h1>
          <NotificationsContainer tab={tab} />
        </Container>
      </main>
    </div>
  );
}
