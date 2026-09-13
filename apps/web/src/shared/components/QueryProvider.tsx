'use client';

import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// 1 QueryClient/session trình duyệt (useState lazy init, không tạo lại mỗi
// render) — chỉ dùng cho server state thật sự (shop, product...), KHÔNG dùng
// để fetch lại user/session hiện tại (vẫn là useAuthStore + AuthHydrator, xem
// Week3.md Bước 3.1).
export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
