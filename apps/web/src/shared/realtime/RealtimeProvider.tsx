'use client';

import { useEffect, useState, type ReactNode } from 'react';

import { useAuthStore } from '@/modules/auth';
import { API_BASE_URL, refreshSessionNow } from '@/shared/lib/api-client';
import type { RefreshOutcome } from '@/shared/lib/session-refresh';

import { createRealtimeClient, type SocketFactory } from './realtime-client';
import { RealtimeContext } from './realtime-context';
import { defaultSocketFactory } from './socket-factory';

interface RealtimeProviderProps {
  children: ReactNode;
  // Chỉ để test tiêm bản giả. Đọc MỘT lần lúc dựng provider (không đổi giữa chừng).
  createSocket?: SocketFactory;
  refreshSession?: () => Promise<RefreshOutcome>;
}

// Giữ MỘT kết nối real-time cho người đã đăng nhập (Week10.md 3.5). Chỉ kết nối khi AuthHydrator đã biết chắc
// kết quả (`!isHydrating`) VÀ có user — nếu không thì khách vãng lai, hay người đang chờ /auth/me, sẽ tạo kết
// nối vô ích (và tải `socket.io-client` không cần thiết). Đổi người dùng hoặc đăng xuất ⇒ ngắt kết nối cũ.
//
// Chống nhân đôi socket trong React StrictMode (effect chạy mount → cleanup → mount): client dựng một lần
// qua useState, `stop()` ở cleanup làm lần `start()` thứ nhất mất hiệu lực trước khi kịp tạo socket (xem
// `generation` trong realtime-client.ts), nên chỉ lần start thật tạo đúng một socket.
export function RealtimeProvider({
  children,
  createSocket = defaultSocketFactory,
  refreshSession = refreshSessionNow,
}: RealtimeProviderProps) {
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const isHydrating = useAuthStore((state) => state.isHydrating);
  const [client] = useState(() =>
    createRealtimeClient({ url: API_BASE_URL, createSocket, refreshSession }),
  );

  const shouldConnect = !isHydrating && userId !== null;
  useEffect(() => {
    if (!shouldConnect) return;
    client.start();
    return () => client.stop();
    // userId nằm trong deps để ĐỔI người dùng (không qua trang chủ) ngắt kết nối cũ và nối lại bằng cookie mới.
  }, [client, shouldConnect, userId]);

  return <RealtimeContext.Provider value={client}>{children}</RealtimeContext.Provider>;
}
