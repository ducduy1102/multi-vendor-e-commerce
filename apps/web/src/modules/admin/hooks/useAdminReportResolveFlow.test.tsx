import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/shared/lib/api-client';
import { withIntl } from '@/shared/lib/test-i18n';

import { makeResolvedReport, REPORT_ID } from '../admin-report.fixtures';
import * as adminService from '../services/admin.service';
import { useAdminReportResolveFlow } from './useAdminReportResolveFlow';

vi.mock('../services/admin.service', () => ({ resolveReport: vi.fn() }));
const { toastSuccess } = vi.hoisted(() => ({ toastSuccess: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: toastSuccess, error: vi.fn() } }));

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) =>
    withIntl(<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>);
  return renderHook(() => useAdminReportResolveFlow(REPORT_ID), { wrapper });
}

describe('useAdminReportResolveFlow', () => {
  beforeEach(() => {
    vi.mocked(adminService.resolveReport).mockReset();
    toastSuccess.mockReset();
  });

  it('chưa làm gì: hộp thoại đóng, không có lỗi, không gọi API', () => {
    const { result } = setup();

    expect(result.current.dialog.isOpen).toBe(false);
    expect(result.current.dialog.input).toBeNull();
    expect(result.current.actionError).toBeNull();
    expect(adminService.resolveReport).not.toHaveBeenCalled();
  });

  it('request: mở hộp thoại xác nhận với đúng lựa chọn nhưng CHƯA gọi API', () => {
    const { result } = setup();

    act(() => result.current.request({ action: 'HIDE_REVIEW', note: 'Xúc phạm' }));

    expect(result.current.dialog.isOpen).toBe(true);
    expect(result.current.dialog.input).toEqual({ action: 'HIDE_REVIEW', note: 'Xúc phạm' });
    expect(adminService.resolveReport).not.toHaveBeenCalled();
  });

  it('xác nhận: gọi service đúng id + lựa chọn, toast, đóng hộp thoại', async () => {
    vi.mocked(adminService.resolveReport).mockResolvedValue(makeResolvedReport());
    const { result } = setup();
    act(() => result.current.request({ action: 'HIDE_REVIEW', note: 'Xúc phạm' }));

    act(() => result.current.dialog.onConfirm());

    await waitFor(() => expect(result.current.dialog.isOpen).toBe(false));
    expect(adminService.resolveReport).toHaveBeenCalledWith(REPORT_ID, {
      action: 'HIDE_REVIEW',
      note: 'Xúc phạm',
    });
    expect(toastSuccess).toHaveBeenCalledWith('Đã xử lý báo cáo.');
    expect(result.current.actionError).toBeNull();
  });

  it('lỗi có mã nghiệp vụ (409 REPORT_ALREADY_CLOSED): câu đã dịch, hộp thoại đóng, KHÔNG toast thành công', async () => {
    vi.mocked(adminService.resolveReport).mockRejectedValue(
      new ApiError('Report already closed', 409, 'REPORT_ALREADY_CLOSED'),
    );
    const { result } = setup();
    act(() => result.current.request({ action: 'DISMISS' }));

    act(() => result.current.dialog.onConfirm());

    await waitFor(() => expect(result.current.actionError).not.toBeNull());
    expect(result.current.actionError).toMatch(/xử lý/i);
    expect(result.current.actionError).not.toContain('Report already closed');
    expect(result.current.dialog.isOpen).toBe(false);
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it('lỗi không rõ (mất mạng) ⇒ câu chung, không lộ message gốc', async () => {
    vi.mocked(adminService.resolveReport).mockRejectedValue(new TypeError('Failed to fetch'));
    const { result } = setup();
    act(() => result.current.request({ action: 'DISMISS' }));

    act(() => result.current.dialog.onConfirm());

    await waitFor(() =>
      expect(result.current.actionError).toBe('Không thực hiện được thao tác, vui lòng thử lại'),
    );
  });

  it('đang gửi: không đóng được hộp thoại (Esc / bấm nền) cho tới khi xong', async () => {
    let finish: (value: ReturnType<typeof makeResolvedReport>) => void = () => undefined;
    vi.mocked(adminService.resolveReport).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const { result } = setup();
    act(() => result.current.request({ action: 'DISMISS' }));
    act(() => result.current.dialog.onConfirm());
    await waitFor(() => expect(result.current.isPending).toBe(true));

    act(() => result.current.dialog.onOpenChange(false));

    expect(result.current.dialog.isOpen).toBe(true);
    await act(async () => finish(makeResolvedReport()));
    await waitFor(() => expect(result.current.dialog.isOpen).toBe(false));
  });

  it('đóng hộp thoại bằng tay (không gửi) không gọi API', () => {
    const { result } = setup();
    act(() => result.current.request({ action: 'DISMISS' }));

    act(() => result.current.dialog.onOpenChange(false));

    expect(result.current.dialog.isOpen).toBe(false);
    expect(adminService.resolveReport).not.toHaveBeenCalled();
  });

  // Hai ca dưới là HAI đường xoá câu lỗi cũ, mỗi đường một ca: đường nào cũng có lớp kia che nếu chỉ kiểm qua giao diện đầy đủ
  // (chọn lại rồi bấm xác nhận đi qua cả hai), nên phải gọi riêng từng hàm.
  it('mở hộp thoại cho một lần xử lý mới (request) xoá ngay câu lỗi của lần trước', async () => {
    vi.mocked(adminService.resolveReport).mockRejectedValue(new TypeError('Failed to fetch'));
    const { result } = setup();
    act(() => result.current.request({ action: 'DISMISS' }));
    act(() => result.current.dialog.onConfirm());
    await waitFor(() => expect(result.current.actionError).not.toBeNull());

    act(() => result.current.request({ action: 'DISMISS' }));

    expect(result.current.actionError).toBeNull();
    expect(result.current.dialog.isOpen).toBe(true);
  });

  it('xác nhận lại sau một lần lỗi (không request lại) xoá câu lỗi cũ ngay khi bắt đầu gửi', async () => {
    let finish: (value: ReturnType<typeof makeResolvedReport>) => void = () => undefined;
    vi.mocked(adminService.resolveReport)
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockReturnValueOnce(
        new Promise((resolve) => {
          finish = resolve;
        }),
      );
    const { result } = setup();
    act(() => result.current.request({ action: 'DISMISS' }));
    act(() => result.current.dialog.onConfirm());
    await waitFor(() => expect(result.current.actionError).not.toBeNull());

    act(() => result.current.dialog.onConfirm());

    await waitFor(() => expect(result.current.isPending).toBe(true));
    expect(result.current.actionError).toBeNull();
    await act(async () => finish(makeResolvedReport()));
    await waitFor(() => expect(result.current.isPending).toBe(false));
  });

  it('xác nhận khi chưa có lựa chọn nào (chưa request) ⇒ không gọi API, không toast, không lỗi giả', async () => {
    const { result } = setup();

    act(() => result.current.dialog.onConfirm());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(adminService.resolveReport).not.toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(result.current.actionError).toBeNull();
  });
});
