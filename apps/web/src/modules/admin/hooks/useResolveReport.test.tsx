import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/shared/lib/api-client';

import { makeResolvedReport, makeReviewReport, REPORT_ID } from '../admin-report.fixtures';
import * as adminService from '../services/admin.service';
import {
  adminOverviewQueryKey,
  adminReportDetailQueryKey,
  adminReportListsQueryKey,
  adminShopListsQueryKey,
  adminUserListsQueryKey,
} from './admin-query-keys';
import { useResolveReport } from './useResolveReport';

vi.mock('../services/admin.service', () => ({ resolveReport: vi.fn() }));

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper, invalidate };
}

const invalidatedKeys = (invalidate: ReturnType<typeof setup>['invalidate']) =>
  invalidate.mock.calls.map(([filters]) => filters?.queryKey);

describe('useResolveReport', () => {
  beforeEach(() => {
    vi.mocked(adminService.resolveReport).mockReset();
  });

  it('gọi service với id báo cáo và đúng { action, note } (id không lẫn vào body)', async () => {
    vi.mocked(adminService.resolveReport).mockResolvedValue(makeResolvedReport());
    const { wrapper } = setup();
    const { result } = renderHook(() => useResolveReport(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        reportId: REPORT_ID,
        action: 'HIDE_REVIEW',
        note: 'Xúc phạm',
      });
    });

    expect(adminService.resolveReport).toHaveBeenCalledWith(REPORT_ID, {
      action: 'HIDE_REVIEW',
      note: 'Xúc phạm',
    });
  });

  it('thành công: ghi báo cáo đã xử lý vào cache chi tiết NGAY và làm mới hàng đợi, số việc chờ, shop, người dùng', async () => {
    const resolved = makeResolvedReport();
    vi.mocked(adminService.resolveReport).mockResolvedValue(resolved);
    const { wrapper, queryClient, invalidate } = setup();
    queryClient.setQueryData(adminReportDetailQueryKey(REPORT_ID), makeReviewReport());
    const { result } = renderHook(() => useResolveReport(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ reportId: REPORT_ID, action: 'DISMISS' });
    });

    expect(queryClient.getQueryData(adminReportDetailQueryKey(REPORT_ID))).toEqual(resolved);
    const keys = invalidatedKeys(invalidate);
    expect(keys).toContainEqual(adminReportListsQueryKey());
    expect(keys).toContainEqual(adminOverviewQueryKey());
    expect(keys).toContainEqual(adminShopListsQueryKey());
    expect(keys).toContainEqual(adminUserListsQueryKey());
  });

  it('LỖI (409 Admin khác xử lý trước): vẫn làm mới chi tiết + hàng đợi + số việc chờ để dữ liệu hiển thị không còn cũ, và không ghi đè cache', async () => {
    vi.mocked(adminService.resolveReport).mockRejectedValue(
      new ApiError('Report already closed', 409, 'REPORT_ALREADY_CLOSED'),
    );
    const { wrapper, queryClient, invalidate } = setup();
    const before = makeReviewReport();
    queryClient.setQueryData(adminReportDetailQueryKey(REPORT_ID), before);
    const { result } = renderHook(() => useResolveReport(), { wrapper });

    await act(async () => {
      await result.current
        .mutateAsync({ reportId: REPORT_ID, action: 'DISMISS' })
        .catch(() => undefined);
    });

    expect(queryClient.getQueryData(adminReportDetailQueryKey(REPORT_ID))).toEqual(before);
    const keys = invalidatedKeys(invalidate);
    expect(keys).toContainEqual(adminReportDetailQueryKey(REPORT_ID));
    expect(keys).toContainEqual(adminReportListsQueryKey());
    expect(keys).toContainEqual(adminOverviewQueryKey());
  });
});
