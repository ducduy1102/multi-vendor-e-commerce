import { getTranslations } from 'next-intl/server';

import { ChatInboxContainer, parseChatPageQuery } from '@/modules/chat';
import { Container } from '@/shared/components/Container';

import { ReportEntry } from '../_components/ReportEntry';

interface ChatPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

// Hộp thư của NGƯỜI MUA. Server Component — đọc `?c=<id>` (hội thoại đang chọn) qua prop searchParams (không dùng
// useSearchParams(), đúng rules/frontend.md mục 2); `c` sai dạng rơi về "chưa chọn", không làm sập trang. Dữ liệu
// hội thoại là dữ liệu cá nhân theo session nên lấy phía client trong ChatInboxContainer (TanStack Query +
// real-time). Bảo vệ đăng nhập ở proxy.ts (PROTECTED_PATH_PREFIXES), không tự kiểm tra lại ở đây. Tiêu đề chỉ hiện
// từ `md`: màn hẹp cần từng dòng cho khung chat (tiêu đề hội thoại đã nằm ngay trong khung); trình đọc màn hình vẫn
// đọc `h1` ở mọi cỡ.
export default async function ChatPage({ searchParams }: ChatPageProps) {
  const [rawParams, t] = await Promise.all([searchParams, getTranslations('chat')]);
  const { conversationId } = parseChatPageQuery(rawParams);

  return (
    <div className="flex flex-1 flex-col">
      <main className="flex flex-1 flex-col">
        <Container className="flex flex-1 flex-col gap-4 py-4 md:py-6">
          <h1 className="sr-only text-xl font-semibold text-foreground md:not-sr-only">
            {t('pageTitleBuyer')}
          </h1>
          <ChatInboxContainer
            scope={{ role: 'BUYER' }}
            selectedId={conversationId}
            basePath="/chat"
            reportSlot={
              conversationId ? (
                <ReportEntry targetType="CONVERSATION" targetId={conversationId} />
              ) : null
            }
          />
        </Container>
      </main>
    </div>
  );
}
