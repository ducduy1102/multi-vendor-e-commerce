'use client';

import { lazy, Suspense } from 'react';

import { useAuthStore } from '@/modules/auth';
import { ChunkFailureBoundary } from '@/shared/components/ChunkFailureBoundary';

// Các mảnh giao diện của chat chỉ NGƯỜI ĐÃ ĐĂNG NHẬP mới dùng (đồng bộ real-time, biểu tượng + huy hiệu tin nhắn ở
// Header/AccountSheet), nhưng chúng nằm ở layout/Header nên nếu import tĩnh thì mọi khách vãng lai cũng tải mã dữ liệu
// chat (hook, dịch vụ, schema, đồng bộ real-time) mà không bao giờ chạy: đo bằng Lighthouse khi so `main` trước/sau chat
// FE là +14,8 KB JS và 2 tệp script thêm ở `/` và `/products` (Week10.md 6.3). `React.lazy` + `import()` tách chúng ra
// chunk riêng, và cổng `useAuthStore` bên dưới bảo đảm chunk chỉ được yêu cầu khi `user !== null` — cùng ý với việc nạp
// động `socket.io-client` ở shared/realtime (khách không tải byte nào).
//
// QUY TẮC: Header, AccountSheet, BottomTabBar, SessionCacheReset, layout KHÔNG được import tĩnh ChatRealtimeSync /
// HeaderChatLink / ChatUnreadBadge / useChatBadges / `@/modules/chat` — luôn đi qua các wrapper ở file này (`guest-bundle
// .test.ts` giữ điều đó). Đây là mã chạy sau hydrate (cổng đọc store client), không bao giờ được dựng ở server nên không
// có lệch hydration. KHÔNG giao việc quan trọng (như dọn dữ liệu riêng tư khi đổi tài khoản) cho các mảnh nạp trễ này:
// chúng có thể chưa kịp về — việc đó đi qua shared/lib/session-reset.ts.
const ChatRealtimeSyncImpl = lazy(() =>
  import('./ChatRealtimeSync').then((module) => ({ default: module.ChatRealtimeSync })),
);
const HeaderChatLinkImpl = lazy(() =>
  import('./HeaderChatLink').then((module) => ({ default: module.HeaderChatLink })),
);
const ChatUnreadBadgeImpl = lazy(() =>
  import('./ChatUnreadBadge').then((module) => ({ default: module.ChatUnreadBadge })),
);

function useIsSignedIn(): boolean {
  return useAuthStore((state) => state.user !== null);
}

// Đồng bộ real-time của chat cho cả phiên (mount MỘT lần ở layout).
export function LazyChatRealtimeSync() {
  const isSignedIn = useIsSignedIn();
  if (!isSignedIn) return null;

  return (
    <ChunkFailureBoundary>
      <Suspense fallback={null}>
        <ChatRealtimeSyncImpl />
      </Suspense>
    </ChunkFailureBoundary>
  );
}

// Biểu tượng tin nhắn ở Header. Trong lúc chunk đang tải giữ chỗ ĐÚNG cỡ nút icon (size-8) để các nút bên cạnh không
// bị đẩy lệch khi biểu tượng hiện ra (CLS).
export function LazyHeaderChatLink({ className }: { className?: string }) {
  const isSignedIn = useIsSignedIn();
  if (!isSignedIn) return null;

  return (
    <ChunkFailureBoundary>
      <Suspense
        fallback={
          <div className={className}>
            <span className="size-8" aria-hidden="true" />
          </div>
        }
      >
        <HeaderChatLinkImpl className={className} />
      </Suspense>
    </ChunkFailureBoundary>
  );
}

// Huy hiệu số chưa đọc đặt trong avatar/tab/mục menu: không cần giữ chỗ vì huy hiệu định vị tuyệt đối hoặc chỉ nối thêm
// ở cuối một mục menu (`ml-auto`), và dữ liệu số vốn đến bất đồng bộ.
export function LazyChatUnreadBadge({
  scope,
  className,
}: {
  scope: 'buyer' | 'shop';
  className?: string;
}) {
  const isSignedIn = useIsSignedIn();
  if (!isSignedIn) return null;

  return (
    <ChunkFailureBoundary>
      <Suspense fallback={null}>
        <ChatUnreadBadgeImpl scope={scope} className={className} />
      </Suspense>
    </ChunkFailureBoundary>
  );
}
