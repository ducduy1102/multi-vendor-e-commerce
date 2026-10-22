import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from '@testing-library/react';
import type { ReactNode } from 'react';
import { vi } from 'vitest';

import type { RefreshOutcome } from '@/shared/lib/session-refresh';

import type { SocketFactory } from './realtime-client';
import { RealtimeProvider } from './RealtimeProvider';
import { signInForRealtimeTest, signOutAfterRealtimeTest } from './test-auth';
import { FakeSocket } from './test-socket';

// Khung dựng CHỈ cho test hook real-time của các module (chat, thông báo — không import từ mã chạy thật): QueryClient
// không thử lại + một RealtimeProvider dùng socket giả để test đóng vai server. Nằm ở shared/realtime (cùng test-auth /
// test-socket) để module nghiệp vụ dựng test mà không import nhau (shared/lib/module-boundaries.test.ts).

export interface RealtimeTestHarness {
  queryClient: QueryClient;
  socket: FakeSocket;
  wrapper: ({ children }: { children: ReactNode }) => ReactNode;
  // Cho các việc bất đồng bộ đang treo chạy xong (tạo socket, mutation...).
  settle: () => Promise<void>;
  // Bật kết nối như server đã chấp nhận.
  connect: () => Promise<void>;
}

export function createRealtimeHarness(): RealtimeTestHarness {
  const socket = new FakeSocket();
  const createSocket = vi.fn<SocketFactory>(() => Promise.resolve(socket));
  const refreshSession = vi.fn<() => Promise<RefreshOutcome>>().mockResolvedValue('refreshed');
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  signInForRealtimeTest();

  const settle = () => act(async () => {});
  return {
    queryClient,
    socket,
    wrapper: ({ children }) => (
      <QueryClientProvider client={queryClient}>
        <RealtimeProvider createSocket={createSocket} refreshSession={refreshSession}>
          {children}
        </RealtimeProvider>
      </QueryClientProvider>
    ),
    settle,
    connect: async () => {
      await settle();
      act(() => socket.serverConnects());
    },
  };
}

// Gỡ trạng thái đăng nhập giả. Gọi SAU `cleanup()` của RTL.
export const resetRealtimeHarnessAuth = signOutAfterRealtimeTest;
