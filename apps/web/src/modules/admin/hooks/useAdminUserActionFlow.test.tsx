import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/shared/lib/api-client';
import { withIntl } from '@/shared/lib/test-i18n';

import * as adminService from '../services/admin.service';
import { useAdminUserActionFlow, type AdminUserActionTarget } from './useAdminUserActionFlow';

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
vi.mock('../services/admin.service', () => ({
  suspendUser: vi.fn(),
  reactivateUser: vi.fn(),
}));

const USER: AdminUserActionTarget = {
  id: 'u-1',
  name: 'Nguyễn Văn An',
  email: 'an@example.com',
  statusReason: null,
};

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) =>
    withIntl(<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>);
  return renderHook(() => useAdminUserActionFlow(), { wrapper });
}

const apiError = (status: number, code?: string) => new ApiError('x', status, code);

describe('useAdminUserActionFlow', () => {
  beforeEach(() => {
    vi.mocked(adminService.suspendUser).mockReset();
    vi.mocked(adminService.reactivateUser).mockReset();
    toast.success.mockReset();
  });

  it('ban đầu: không hộp thoại nào, không lỗi, không hành động nào đang chạy', () => {
    const { result } = setup();

    expect(result.current.dialogState.dialog).toBeNull();
    expect(result.current.dialogState.isOpen).toBe(false);
    expect(result.current.dialogState.error).toBeNull();
    expect(result.current.isActionPending).toBe(false);
  });

  it('openDialog mở hộp thoại cho đúng hành động + người, xoá lỗi cũ', () => {
    const { result } = setup();

    act(() => result.current.openDialog('ban', USER));

    expect(result.current.dialogState.dialog).toEqual({ action: 'ban', user: USER });
    expect(result.current.dialogState.isOpen).toBe(true);
    expect(result.current.dialogState.error).toBeNull();
  });

  it('khoá thành công: gọi suspend với mức SUSPENDED + lý do, ĐÓNG hộp thoại, báo thành công bằng toast', async () => {
    vi.mocked(adminService.suspendUser).mockResolvedValue({} as never);
    const { result } = setup();
    act(() => result.current.openDialog('suspend', USER));

    await act(async () => result.current.dialogState.onConfirm('Vi phạm'));

    expect(adminService.suspendUser).toHaveBeenCalledWith('u-1', {
      status: 'SUSPENDED',
      reason: 'Vi phạm',
    });
    expect(result.current.dialogState.isOpen).toBe(false);
    expect(toast.success).toHaveBeenCalledWith('Đã tạm khoá Nguyễn Văn An');
  });

  it.each([['ban', 'BANNED', 'Đã cấm Nguyễn Văn An']] as const)(
    '%s -> mức %s, toast "%s"',
    async (action, status, message) => {
      vi.mocked(adminService.suspendUser).mockResolvedValue({} as never);
      const { result } = setup();
      act(() => result.current.openDialog(action, USER));

      await act(async () => result.current.dialogState.onConfirm('Lừa đảo'));

      expect(adminService.suspendUser).toHaveBeenCalledWith('u-1', { status, reason: 'Lừa đảo' });
      expect(toast.success).toHaveBeenCalledWith(message);
    },
  );

  it.each([
    ['reactivate', 'Đã mở lại Nguyễn Văn An'],
    ['unban', 'Đã gỡ cấm Nguyễn Văn An'],
  ] as const)('%s -> gọi reactivate chỉ với lý do, toast "%s"', async (action, message) => {
    vi.mocked(adminService.reactivateUser).mockResolvedValue({} as never);
    const { result } = setup();
    act(() => result.current.openDialog(action, USER));

    await act(async () => result.current.dialogState.onConfirm('Đã xét lại'));

    expect(adminService.reactivateUser).toHaveBeenCalledWith('u-1', { reason: 'Đã xét lại' });
    expect(toast.success).toHaveBeenCalledWith(message);
    expect(result.current.dialogState.isOpen).toBe(false);
  });

  it('409 USER_INVALID_TRANSITION (Admin khác vừa xử lý): lỗi đã dịch hiện TRONG hộp thoại, hộp thoại GIỮ MỞ, không toast thành công', async () => {
    vi.mocked(adminService.suspendUser).mockRejectedValue(apiError(409, 'USER_INVALID_TRANSITION'));
    const { result } = setup();
    act(() => result.current.openDialog('suspend', USER));

    await act(async () => result.current.dialogState.onConfirm('Vi phạm'));

    expect(result.current.dialogState.error).toBe(
      'Trạng thái tài khoản đã thay đổi. Vui lòng tải lại danh sách.',
    );
    expect(result.current.dialogState.isOpen).toBe(true);
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('lỗi không rõ (mất mạng, 500...) -> thông báo chung, không lộ message gốc', async () => {
    vi.mocked(adminService.suspendUser).mockRejectedValue(new Error('boom: stack trace'));
    const { result } = setup();
    act(() => result.current.openDialog('suspend', USER));

    await act(async () => result.current.dialogState.onConfirm('Vi phạm'));

    expect(result.current.dialogState.error).toBe(
      'Không thực hiện được thao tác, vui lòng thử lại',
    );
    expect(result.current.dialogState.error).not.toContain('boom');
  });

  it('sau lỗi, mở hộp thoại lần nữa xoá lỗi cũ; thử lại thành công thì đóng', async () => {
    vi.mocked(adminService.suspendUser)
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({} as never);
    const { result } = setup();
    act(() => result.current.openDialog('suspend', USER));
    await act(async () => result.current.dialogState.onConfirm('Vi phạm'));
    expect(result.current.dialogState.error).not.toBeNull();

    await act(async () => result.current.dialogState.onConfirm('Vi phạm'));

    expect(result.current.dialogState.error).toBeNull();
    expect(result.current.dialogState.isOpen).toBe(false);
  });

  it('đang gửi yêu cầu thì KHÔNG cho đóng hộp thoại (Esc/bấm nền); xong rồi thì đóng được', async () => {
    let resolve: (value: never) => void = () => undefined;
    vi.mocked(adminService.suspendUser).mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    const { result } = setup();
    act(() => result.current.openDialog('suspend', USER));

    let pending: Promise<void> = Promise.resolve();
    act(() => {
      pending = Promise.resolve(result.current.dialogState.onConfirm('Vi phạm'));
    });
    await vi.waitFor(() => expect(result.current.dialogState.isPending).toBe(true));

    act(() => result.current.dialogState.onOpenChange(false));
    expect(result.current.dialogState.isOpen).toBe(true);
    expect(result.current.isActionPending).toBe(true);

    await act(async () => {
      resolve({} as never);
      await pending;
    });
    await vi.waitFor(() => expect(result.current.dialogState.isOpen).toBe(false));

    act(() => result.current.openDialog('ban', USER));
    act(() => result.current.dialogState.onOpenChange(false));
    expect(result.current.dialogState.isOpen).toBe(false);
  });

  it('xác nhận khi chưa mở hộp thoại nào -> không gọi API', async () => {
    const { result } = setup();

    await act(async () => result.current.dialogState.onConfirm('x'));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(adminService.suspendUser).not.toHaveBeenCalled();
    expect(adminService.reactivateUser).not.toHaveBeenCalled();
    expect(result.current.dialogState.error).toBeNull();
  });
});
