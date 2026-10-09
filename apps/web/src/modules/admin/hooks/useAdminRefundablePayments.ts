import { useQuery } from '@tanstack/react-query';

import { shouldRetryQuery } from '@/shared/lib/should-retry-query';

import * as adminService from '../services/admin.service';
import type { AdminRefundablePaymentListQuery } from '../types';
import { adminRefundablePaymentListQueryKey } from './admin-query-keys';

// Thanh toán bất thường chưa có khoản hoàn nào (đến muộn sau khi đơn đã hủy / trả hai lần). 401/403 không
// thử lại, lỗi tạm thời thử lại tối đa 2 lần.
export function useAdminRefundablePayments(query: Partial<AdminRefundablePaymentListQuery> = {}) {
  return useQuery({
    queryKey: adminRefundablePaymentListQueryKey(query),
    queryFn: () => adminService.listRefundablePayments(query),
    retry: shouldRetryQuery,
  });
}
