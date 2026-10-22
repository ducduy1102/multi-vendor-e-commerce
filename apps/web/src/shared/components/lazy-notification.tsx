'use client';

import { lazy, Suspense } from 'react';

import { useAuthStore } from '@/modules/auth';
import { ChunkFailureBoundary } from '@/shared/components/ChunkFailureBoundary';

// Các mảnh giao diện của thông báo chỉ NGƯỜI ĐÃ ĐĂNG NHẬP mới dùng (đồng bộ real-time, chuông + huy hiệu ở Header/AccountSheet),
// nhưng chúng nằm ở layout/Header nên nếu import tĩnh thì mọi khách vãng lai cũng tải mã dữ liệu thông báo (hook, dịch
// vụ, schema, bảng ánh xạ hiển thị, toast) mà không bao giờ chạy — cùng vấn đề và cùng cách chữa với chat (xem
// lazy-chat.tsx; đo Lighthouse Week10.md 6.3). `React.lazy` + `import()` tách chúng ra chunk riêng, và cổng `useAuthStore`
// bên dưới bảo đảm chunk chỉ được yêu cầu khi `user !== null`.
//
// QUY TẮC: Header, AccountSheet, BottomTabBar, SessionCacheReset, layout KHÔNG được import tĩnh NotificationRealtimeSync /
// NotificationBell / NotificationUnreadBadge / `@/modules/notification` — luôn đi qua các wrapper ở file này
// (`guest-bundle.test.ts` giữ điều đó). KHÔNG giao việc quan trọng cho các mảnh nạp trễ này (chúng có thể chưa kịp về).
const NotificationRealtimeSyncImpl = lazy(() =>
  import('./NotificationRealtimeSync').then((module) => ({
    default: module.NotificationRealtimeSync,
  })),
);
const NotificationBellImpl = lazy(() =>
  import('./NotificationBell').then((module) => ({ default: module.NotificationBell })),
);
const NotificationUnreadBadgeImpl = lazy(() =>
  import('./NotificationUnreadBadge').then((module) => ({
    default: module.NotificationUnreadBadge,
  })),
);

function useIsSignedIn(): boolean {
  return useAuthStore((state) => state.user !== null);
}

// Đồng bộ real-time của thông báo cho cả phiên (mount MỘT lần ở layout).
export function LazyNotificationRealtimeSync() {
  const isSignedIn = useIsSignedIn();
  if (!isSignedIn) return null;

  return (
    <ChunkFailureBoundary>
      <Suspense fallback={null}>
        <NotificationRealtimeSyncImpl />
      </Suspense>
    </ChunkFailureBoundary>
  );
}

// Chuông ở Header. Trong lúc chunk đang tải giữ chỗ ĐÚNG cỡ nút icon (size-8) để các nút bên cạnh không bị đẩy lệch khi
// chuông hiện ra (CLS).
export function LazyNotificationBell({ className }: { className?: string }) {
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
        <NotificationBellImpl className={className} />
      </Suspense>
    </ChunkFailureBoundary>
  );
}

// Huy hiệu số chưa đọc đặt trong mục menu: không cần giữ chỗ vì huy hiệu chỉ nối thêm ở cuối một mục menu (`ml-auto`) và
// dữ liệu số vốn đến bất đồng bộ.
export function LazyNotificationUnreadBadge({ className }: { className?: string }) {
  const isSignedIn = useIsSignedIn();
  if (!isSignedIn) return null;

  return (
    <ChunkFailureBoundary>
      <Suspense fallback={null}>
        <NotificationUnreadBadgeImpl className={className} />
      </Suspense>
    </ChunkFailureBoundary>
  );
}
