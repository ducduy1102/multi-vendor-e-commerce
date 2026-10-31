'use client';

import { useTranslations } from 'next-intl';
import { use } from 'react';

import { ChatInboxContainer, parseChatPageQuery } from '@/modules/chat';
import { Skeleton } from '@/shared/components/ui/skeleton';

import { ReportEntry } from '../../_components/ReportEntry';
import { SellerShopGate } from '../_components/SellerShopGate';

interface SellerChatPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

// Hộp thư của CHỦ SHOP. Composition root: SellerShopGate resolve "shop của tôi" (modules/shop) rồi truyền shopId
// xuống ChatInboxContainer của modules/chat — hai module không cross-import nhau (rules/general.md mục 1). Tự động
// được bảo vệ đăng nhập vì nằm dưới prefix /seller ở proxy.ts. Là Client Component (cổng cần useMyShop) nên đọc
// `?c=<id>` bằng `use(searchParams)` — cách Next.js dành cho Client Component page, không dùng useSearchParams().
// Hộp thư này CHỈ chứa hội thoại của shop đó; tin nhắn của chính chủ shop với tư cách người mua nằm ở /chat.
export default function SellerChatPage({ searchParams }: SellerChatPageProps) {
  const t = useTranslations('chat');
  const { conversationId } = parseChatPageQuery(use(searchParams));

  return (
    <SellerShopGate
      compact
      skeleton={
        <>
          <Skeleton className="h-7 w-48 motion-reduce:animate-none" aria-hidden="true" />
          <Skeleton
            className="h-96 w-full rounded-xl motion-reduce:animate-none"
            aria-hidden="true"
          />
        </>
      }
    >
      {(shopId) => (
        <div className="flex flex-col gap-4">
          <h1 className="sr-only text-xl font-semibold text-foreground md:not-sr-only">
            {t('pageTitleSeller')}
          </h1>
          <ChatInboxContainer
            scope={{ role: 'SHOP', shopId }}
            selectedId={conversationId}
            basePath="/seller/chat"
            reportSlot={
              conversationId ? (
                <ReportEntry targetType="CONVERSATION" targetId={conversationId} />
              ) : null
            }
          />
        </div>
      )}
    </SellerShopGate>
  );
}
