import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { makeNote, makeNotePage } from '../admin-note.fixtures';
import * as adminService from '../services/admin.service';
import { adminNotesQueryKey } from './admin-query-keys';
import { useAdminNotes } from './useAdminNotes';

vi.mock('../services/admin.service', () => ({ listAdminNotes: vi.fn() }));

const SHOP_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { wrapper, queryClient };
}

describe('useAdminNotes', () => {
  beforeEach(() => {
    vi.mocked(adminService.listAdminNotes).mockReset();
  });

  it('tải trang 1 với đúng đối tượng và kích thước trang', async () => {
    vi.mocked(adminService.listAdminNotes).mockResolvedValue(makeNotePage([makeNote()]));
    const { wrapper } = setup();

    const { result } = renderHook(() => useAdminNotes({ targetType: 'SHOP', targetId: SHOP_ID }), {
      wrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(adminService.listAdminNotes).toHaveBeenCalledWith({
      targetType: 'SHOP',
      targetId: SHOP_ID,
      page: 1,
      limit: 20,
    });
    expect(result.current.hasNextPage).toBe(false);
  });

  it('còn ghi chú chưa tải ⇒ hasNextPage, fetchNextPage gọi đúng trang kế tiếp và giữ trang trước', async () => {
    vi.mocked(adminService.listAdminNotes)
      .mockResolvedValueOnce(
        makeNotePage([makeNote({ id: 'a' })], { page: 1, limit: 20, total: 21 }),
      )
      .mockResolvedValueOnce(
        makeNotePage([makeNote({ id: 'b' })], { page: 2, limit: 20, total: 21 }),
      );
    const { wrapper } = setup();
    const { result } = renderHook(() => useAdminNotes({ targetType: 'USER', targetId: USER_ID }), {
      wrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.hasNextPage).toBe(true);

    await result.current.fetchNextPage();
    await waitFor(() => expect(result.current.data?.pages).toHaveLength(2));

    expect(adminService.listAdminNotes).toHaveBeenLastCalledWith({
      targetType: 'USER',
      targetId: USER_ID,
      page: 2,
      limit: 20,
    });
    expect(result.current.hasNextPage).toBe(false);
  });

  it('mỗi đối tượng một mục cache riêng (không lẫn ghi chú của shop với người dùng)', async () => {
    vi.mocked(adminService.listAdminNotes).mockResolvedValue(makeNotePage([makeNote()]));
    const { wrapper, queryClient } = setup();

    const shop = renderHook(() => useAdminNotes({ targetType: 'SHOP', targetId: SHOP_ID }), {
      wrapper,
    });
    const user = renderHook(() => useAdminNotes({ targetType: 'USER', targetId: USER_ID }), {
      wrapper,
    });
    await waitFor(() => expect(shop.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(user.result.current.isSuccess).toBe(true));

    expect(queryClient.getQueryData(adminNotesQueryKey('SHOP', SHOP_ID))).toBeDefined();
    expect(queryClient.getQueryData(adminNotesQueryKey('USER', USER_ID))).toBeDefined();
    expect(adminNotesQueryKey('SHOP', SHOP_ID)).not.toEqual(adminNotesQueryKey('USER', USER_ID));
  });

  it('404 (đối tượng không còn) không thử lại: lỗi hiện ngay', async () => {
    const { ApiError } = await import('@/shared/lib/api-client');
    vi.mocked(adminService.listAdminNotes).mockRejectedValue(
      new ApiError('Note target not found', 404, 'ADMIN_NOTE_TARGET_NOT_FOUND'),
    );
    const queryClient = new QueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(() => useAdminNotes({ targetType: 'SHOP', targetId: SHOP_ID }), {
      wrapper,
    });
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(adminService.listAdminNotes).toHaveBeenCalledTimes(1);
  });
});
