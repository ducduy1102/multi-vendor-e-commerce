'use client';

import { MessageCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Link, usePathname, useRouter } from '@/i18n/navigation';
import { Button, buttonVariants } from '@/shared/components/ui/button';

import { useDescribeChatError } from '../hooks/useDescribeChatError';
import { useOpenConversation } from '../hooks/useOpenConversation';

interface ShopChatButtonProps {
  shopId: string;
  // Người xem đã đăng nhập chưa (do nơi ghép biết qua `useAuthStore` — module chat không import `auth`).
  isAuthenticated: boolean;
  // Người xem chính là chủ shop này ⇒ KHÔNG hiện nút (không ai nhắn tin cho shop của chính mình; BE cũng chặn bằng
  // 409 CHAT_OWN_SHOP). Nơi ghép tính (module chat không biết "shop của tôi").
  isOwnShop?: boolean;
}

// Nút "Chat với shop" (trang shop công khai, chi tiết đơn của người mua). Ba trạng thái:
//  - khách vãng lai: LINK sang `/login?next=<trang hiện tại>` — đăng nhập xong quay lại đúng trang này để bấm tiếp
//    (chưa thể mở hội thoại khi chưa có phiên; `next` đi qua allow-list `safeNextPath` ở proxy/login);
//  - đã đăng nhập: bấm ⇒ `POST /conversations` (idempotent: bấm đúp/hai tab vẫn một hội thoại) rồi chuyển sang
//    `/chat?c=<id>`; đang mở thì tắt nút để chặn bấm lặp. Bản tóm tắt hội thoại được ghi sẵn vào cache nên khung chat
//    có tên + logo shop ngay cả khi hội thoại còn trống (chưa nằm trong danh sách);
//  - lỗi (email chưa xác thực, vượt trần hội thoại mới/ngày, shop không còn hiển thị, mất mạng): câu đã dịch ngay dưới
//    nút (`role="alert"`), không hiện `error.message` thô.
export function ShopChatButton({
  shopId,
  isAuthenticated,
  isOwnShop = false,
}: ShopChatButtonProps) {
  const t = useTranslations('chat');
  const router = useRouter();
  const pathname = usePathname();
  const openConversation = useOpenConversation();
  const { describeOpenError } = useDescribeChatError();

  if (isOwnShop) return null;

  if (!isAuthenticated) {
    return (
      <Link
        href={{ pathname: '/login', query: { next: pathname } }}
        className={buttonVariants({ variant: 'outline' })}
      >
        <MessageCircle aria-hidden="true" />
        {t('chatWithShop')}
      </Link>
    );
  }

  return (
    <div className="flex flex-col items-start gap-1 lg:items-end">
      <Button
        type="button"
        variant="outline"
        disabled={openConversation.isPending}
        aria-busy={openConversation.isPending}
        onClick={() =>
          openConversation.mutate(shopId, {
            onSuccess: (summary) => router.push(`/chat?c=${encodeURIComponent(summary.id)}`),
          })
        }
      >
        <MessageCircle aria-hidden="true" />
        {openConversation.isPending ? t('openingConversation') : t('chatWithShop')}
      </Button>
      {openConversation.isError ? (
        <p role="alert" className="max-w-xs text-xs break-words text-destructive">
          {describeOpenError(openConversation.error)}
        </p>
      ) : null}
    </div>
  );
}
