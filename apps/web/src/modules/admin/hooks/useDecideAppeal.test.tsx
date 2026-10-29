import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { makeAppeal } from '../admin-appeal.fixtures';
import * as adminService from '../services/admin.service';
import {
  adminAppealListsQueryKey,
  adminOverviewQueryKey,
  adminShopListsQueryKey,
} from './admin-query-keys';
import { useDecideAppeal } from './useDecideAppeal';

vi.mock('../services/admin.service', () => ({
  decideAppeal: vi.fn(),
}));

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { wrapper, invalidate };
}

describe('useDecideAppeal', () => {
  beforeEach(() => {
    vi.mocked(adminService.decideAppeal).mockReset();
  });

  it('appealId truyền lúc mutate, tách khỏi body: service nhận (appealId, {decision, note})', async () => {
    vi.mocked(adminService.decideAppeal).mockResolvedValue(makeAppeal());
    const { wrapper } = setup();
    const { result } = renderHook(() => useDecideAppeal(), { wrapper });

    await act(() =>
      result.current.mutateAsync({ appealId: 'appeal-1', decision: 'REJECT', note: 'Chưa đủ' }),
    );

    expect(adminService.decideAppeal).toHaveBeenCalledWith('appeal-1', {
      decision: 'REJECT',
      note: 'Chưa đủ',
    });
  });

  it('chấp nhận không ghi chú -> body không có field note', async () => {
    vi.mocked(adminService.decideAppeal).mockResolvedValue(makeAppeal());
    const { wrapper } = setup();
    const { result } = renderHook(() => useDecideAppeal(), { wrapper });

    await act(() => result.current.mutateAsync({ appealId: 'appeal-1', decision: 'ACCEPT' }));

    expect(adminService.decideAppeal).toHaveBeenCalledWith('appeal-1', { decision: 'ACCEPT' });
  });

  it('thành công -> làm mới MỌI danh sách kháng nghị, danh sách shop (chấp nhận mở khoá shop) và số việc chờ', async () => {
    vi.mocked(adminService.decideAppeal).mockResolvedValue(makeAppeal());
    const { wrapper, invalidate } = setup();
    const { result } = renderHook(() => useDecideAppeal(), { wrapper });

    await act(() => result.current.mutateAsync({ appealId: 'appeal-1', decision: 'ACCEPT' }));

    const keys = invalidate.mock.calls.map(([filter]) => filter?.queryKey);
    expect(keys).toContainEqual(adminAppealListsQueryKey());
    expect(keys).toContainEqual(adminShopListsQueryKey());
    expect(keys).toContainEqual(adminOverviewQueryKey());
    expect(keys).toHaveLength(3);
  });

  it('THẤT BẠI cũng làm mới (thường là 409: Admin khác vừa quyết định, hoặc lần khoá đã kết thúc ⇒ danh sách đang hiện đã cũ)', async () => {
    vi.mocked(adminService.decideAppeal).mockRejectedValue(new Error('409'));
    const { wrapper, invalidate } = setup();
    const { result } = renderHook(() => useDecideAppeal(), { wrapper });

    await act(async () => {
      await result.current
        .mutateAsync({ appealId: 'appeal-1', decision: 'ACCEPT' })
        .catch(() => undefined);
    });

    const keys = invalidate.mock.calls.map(([filter]) => filter?.queryKey);
    expect(keys).toContainEqual(adminAppealListsQueryKey());
    expect(keys).toHaveLength(3);
  });
});
