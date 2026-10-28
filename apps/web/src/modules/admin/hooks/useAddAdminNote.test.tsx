import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { makeNote } from '../admin-note.fixtures';
import * as adminService from '../services/admin.service';
import { useAddAdminNote } from './useAddAdminNote';

vi.mock('../services/admin.service', () => ({ createAdminNote: vi.fn() }));

const SHOP_ID = '11111111-1111-4111-8111-111111111111';
const INPUT = { targetType: 'SHOP', targetId: SHOP_ID, content: 'Ghi chú mới' } as const;

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { wrapper, invalidate };
}

describe('useAddAdminNote', () => {
  beforeEach(() => {
    vi.mocked(adminService.createAdminNote).mockReset();
  });

  it('gửi đúng đối tượng và nội dung cho service, trả ghi chú vừa tạo', async () => {
    vi.mocked(adminService.createAdminNote).mockResolvedValue(makeNote());
    const { wrapper } = setup();
    const { result } = renderHook(() => useAddAdminNote(), { wrapper });

    let created: unknown;
    await act(async () => {
      created = await result.current.mutateAsync(INPUT);
    });

    expect(adminService.createAdminNote).toHaveBeenCalledWith(INPUT);
    expect(created).toEqual(makeNote());
  });

  it('thành công -> làm mới danh sách ghi chú của ĐÚNG đối tượng đó, không đụng đối tượng khác', async () => {
    vi.mocked(adminService.createAdminNote).mockResolvedValue(makeNote());
    const { wrapper, invalidate } = setup();
    const { result } = renderHook(() => useAddAdminNote(), { wrapper });

    await act(() => result.current.mutateAsync(INPUT));

    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['admin', 'notes', 'SHOP', SHOP_ID] });
  });

  it('lỗi -> ném lại và VẪN làm mới (đối tượng có thể vừa biến mất, danh sách đang hiển thị đã cũ)', async () => {
    vi.mocked(adminService.createAdminNote).mockRejectedValue(new Error('boom'));
    const { wrapper, invalidate } = setup();
    const { result } = renderHook(() => useAddAdminNote(), { wrapper });

    let rejection: unknown;
    await act(async () => {
      try {
        await result.current.mutateAsync(INPUT);
      } catch (error) {
        rejection = error;
      }
    });

    expect(rejection).toBeInstanceOf(Error);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['admin', 'notes', 'SHOP', SHOP_ID] });
  });
});
