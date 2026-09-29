'use client';

import { useQuery } from '@tanstack/react-query';
import { useRef } from 'react';

import { ApiError } from '@/shared/lib/api-client';

import * as checkoutService from '../services/checkout.service';
import type { CheckoutGroupStatus } from '../types';

export function checkoutGroupQueryKey(groupId: string) {
  return ['checkout', 'group', groupId] as const;
}

// Lỗi 4xx (404 nhóm không tồn tại/không phải của bạn, 401 chưa đăng nhập) là kết quả chắc chắn,
// thử lại vô ích — cùng quy ước shouldRetry ở useCart.ts/useCheckoutPreview.ts. Không chặn hẳn thử
// lại (chỉ tối đa 2 lần cho lỗi 5xx) để không treo mãi ở "Đang tải..." khi BE lỗi tạm thời.
function shouldRetry(failureCount: number, error: Error): boolean {
  if (error instanceof ApiError && error.status < 500) return false;
  return failureCount < 2;
}

// Trang /checkout/result (3.6, bổ sung theo 1.10): IPN của cổng có thể chưa kịp tới ngay lúc trình
// duyệt redirect về — hỏi lại BE mỗi POLL_INTERVAL_MS trong khi còn AWAITING_PAYMENT, tối đa
// POLL_MAX_MS rồi dừng hẳn (còn AWAITING_PAYMENT thì người dùng tự bấm "Thử lại"/"Tiếp tục thanh
// toán" ở CheckoutResultView, không polling vô hạn).
export const POLL_INTERVAL_MS = 2000;
export const POLL_MAX_MS = 60000;

// Hàm THUẦN (dễ test không cần giả lập timer thật qua react-query) — trả về số ms tới lần refetch
// tiếp theo, hoặc false để dừng. Mọi trạng thái khác AWAITING_PAYMENT coi là đã ổn định.
export function resolvePollInterval(
  status: CheckoutGroupStatus | undefined,
  elapsedMs: number,
): number | false {
  if (status !== 'AWAITING_PAYMENT') return false;
  return elapsedMs < POLL_MAX_MS ? POLL_INTERVAL_MS : false;
}

export function useCheckoutGroup(groupId: string) {
  // Mốc "bắt đầu chờ" — đặt lúc gọi (bên trong refetchInterval, do react-query lên lịch), KHÔNG
  // đặt ngay trong thân hook: `Date.now()` là hàm không thuần, gọi trực tiếp lúc render bị
  // `react-hooks/purity` (React Compiler) chặn dù có canh `=== null` kiểu lazy-ref-init.
  const startedAtRef = useRef<number | null>(null);

  return useQuery({
    queryKey: checkoutGroupQueryKey(groupId),
    queryFn: () => checkoutService.getCheckoutGroup(groupId),
    enabled: Boolean(groupId),
    retry: shouldRetry,
    refetchInterval: (query) => {
      if (startedAtRef.current === null) {
        startedAtRef.current = Date.now();
      }
      return resolvePollInterval(query.state.data?.status, Date.now() - startedAtRef.current);
    },
  });
}
