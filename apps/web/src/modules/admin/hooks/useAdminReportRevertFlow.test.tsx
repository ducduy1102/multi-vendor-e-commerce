import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/shared/lib/api-client';
import { withIntl } from '@/shared/lib/test-i18n';

import {
  makeProductReport,
  makeResolvedProductReport,
  makeResolvedReport,
  makeReviewReport,
  REVIEW_ID,
} from '../admin-report.fixtures';
import * as adminService from '../services/admin.service';
import type { AdminReport } from '../types';
import { useAdminReportRevertFlow } from './useAdminReportRevertFlow';

vi.mock('../services/admin.service', () => ({ unhideReview: vi.fn(), restoreProduct: vi.fn() }));
const { toastSuccess } = vi.hoisted(() => ({ toastSuccess: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: toastSuccess, error: vi.fn() } }));

function setup(initial: AdminReport | undefined) {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) =>
    withIntl(<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>);
  return renderHook(
    ({ report }: { report: AdminReport | undefined }) => useAdminReportRevertFlow(report),
    {
      wrapper,
      initialProps: { report: initial },
    },
  );
}

const PRODUCT_ID = makeProductReport().targetId;

describe('useAdminReportRevertFlow — luồng hoàn tác dùng chung (5.6 mở lại đánh giá, 5.7 khôi phục sản phẩm)', () => {
  beforeEach(() => {
    vi.mocked(adminService.unhideReview).mockReset();
    vi.mocked(adminService.restoreProduct).mockReset();
    toastSuccess.mockReset();
  });

  it('báo cáo chưa xử lý / không hoàn tác được ⇒ kind null, không làm gì khi xác nhận', async () => {
    const { result } = setup(makeReviewReport());

    expect(result.current.kind).toBeNull();
    act(() => result.current.confirm('lý do'));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(adminService.unhideReview).not.toHaveBeenCalled();
    expect(adminService.restoreProduct).not.toHaveBeenCalled();
    expect(result.current.isDone).toBe(false);
  });

  it('chưa có báo cáo (đang tải) ⇒ kind null, isDone false', () => {
    const { result } = setup(undefined);

    expect(result.current.kind).toBeNull();
    expect(result.current.isDone).toBe(false);
  });

  it('ĐÁNH GIÁ đã ẩn ⇒ kind REVIEW, gọi unhideReview bằng ID ĐÁNH GIÁ (không phải id báo cáo), toast "đã mở lại"', async () => {
    vi.mocked(adminService.unhideReview).mockResolvedValue({
      review: { id: REVIEW_ID, isHidden: false, hiddenAt: null },
    });
    const { result } = setup(makeResolvedReport());
    expect(result.current.kind).toBe('REVIEW');
    act(() => result.current.open());

    act(() => result.current.confirm('Đã xét lại'));

    await waitFor(() => expect(result.current.isDone).toBe(true));
    expect(adminService.unhideReview).toHaveBeenCalledWith(REVIEW_ID, { reason: 'Đã xét lại' });
    expect(adminService.restoreProduct).not.toHaveBeenCalled();
    expect(toastSuccess).toHaveBeenCalledWith('Đã mở lại đánh giá.');
    expect(result.current.isOpen).toBe(false);
  });

  it('SẢN PHẨM đã gỡ ⇒ kind PRODUCT, gọi restoreProduct bằng ID SẢN PHẨM (không phải id báo cáo), toast "đã khôi phục"', async () => {
    vi.mocked(adminService.restoreProduct).mockResolvedValue({
      product: { id: PRODUCT_ID, status: 'DRAFT', takenDownAt: null },
    });
    const { result } = setup(makeResolvedProductReport());
    expect(result.current.kind).toBe('PRODUCT');
    act(() => result.current.open());

    act(() => result.current.confirm('Đã xét lại'));

    await waitFor(() => expect(result.current.isDone).toBe(true));
    expect(adminService.restoreProduct).toHaveBeenCalledWith(PRODUCT_ID, { reason: 'Đã xét lại' });
    expect(adminService.unhideReview).not.toHaveBeenCalled();
    expect(toastSuccess).toHaveBeenCalledWith('Đã khôi phục sản phẩm về nháp.');
    expect(result.current.isOpen).toBe(false);
  });

  it('lỗi 409: câu đã dịch, hộp thoại GIỮ MỞ, không toast, chưa "xong"; mở lại hộp thoại xoá lỗi cũ', async () => {
    vi.mocked(adminService.restoreProduct).mockRejectedValue(
      new ApiError('This product is not taken down', 409, 'PRODUCT_NOT_TAKEN_DOWN'),
    );
    const { result } = setup(makeResolvedProductReport());
    act(() => result.current.open());

    act(() => result.current.confirm('x'));

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.error).toBe(
      'Sản phẩm này không ở trạng thái bị gỡ, không có gì để khôi phục.',
    );
    expect(result.current.isOpen).toBe(true);
    expect(result.current.isDone).toBe(false);
    expect(toastSuccess).not.toHaveBeenCalled();

    act(() => result.current.onOpenChange(false));
    act(() => result.current.open());

    expect(result.current.error).toBeNull();
  });

  it('bấm xác nhận LẠI sau một lần lỗi (hộp thoại vẫn mở, không gọi lại open) xoá câu lỗi cũ ngay khi bắt đầu gửi', async () => {
    vi.mocked(adminService.restoreProduct)
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockReturnValueOnce(new Promise(() => undefined));
    const { result } = setup(makeResolvedProductReport());
    act(() => result.current.open());
    act(() => result.current.confirm('x'));
    await waitFor(() => expect(result.current.error).not.toBeNull());

    act(() => result.current.confirm('x'));

    await waitFor(() => expect(result.current.isPending).toBe(true));
    expect(result.current.error).toBeNull();
    expect(result.current.isOpen).toBe(true);
  });

  it('lỗi mất mạng ⇒ câu chung, không lộ thông điệp gốc', async () => {
    vi.mocked(adminService.unhideReview).mockRejectedValue(new TypeError('Failed to fetch'));
    const { result } = setup(makeResolvedReport());

    act(() => result.current.confirm('x'));

    await waitFor(() =>
      expect(result.current.error).toBe('Không thực hiện được thao tác, vui lòng thử lại'),
    );
  });

  it('đang gửi: không đóng được hộp thoại (Esc / bấm nền) cho tới khi xong', async () => {
    let finish: (value: {
      product: { id: string; status: 'DRAFT'; takenDownAt: null };
    }) => void = () => undefined;
    vi.mocked(adminService.restoreProduct).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const { result } = setup(makeResolvedProductReport());
    act(() => result.current.open());
    act(() => result.current.confirm('x'));
    await waitFor(() => expect(result.current.isPending).toBe(true));

    act(() => result.current.onOpenChange(false));

    expect(result.current.isOpen).toBe(true);
    await act(async () =>
      finish({ product: { id: PRODUCT_ID, status: 'DRAFT', takenDownAt: null } }),
    );
    await waitFor(() => expect(result.current.isOpen).toBe(false));
  });

  it('khi KHÔNG gửi, đóng hộp thoại bằng tay được', () => {
    const { result } = setup(makeResolvedProductReport());
    act(() => result.current.open());

    act(() => result.current.onOpenChange(false));

    expect(result.current.isOpen).toBe(false);
  });

  it('"đã khôi phục" nhớ THEO id báo cáo: đổi sang báo cáo khác không mang cờ "đã" của báo cáo trước', async () => {
    vi.mocked(adminService.restoreProduct).mockResolvedValue({
      product: { id: PRODUCT_ID, status: 'DRAFT', takenDownAt: null },
    });
    const first = makeResolvedProductReport();
    const second = makeResolvedProductReport({ id: 'a1b2c3d4-1234-4a5b-8c9d-abcdef000099' });
    const { result, rerender } = setup(first);
    act(() => result.current.confirm('x'));
    await waitFor(() => expect(result.current.isDone).toBe(true));

    rerender({ report: second });

    expect(result.current.isDone).toBe(false);
    rerender({ report: first });
    expect(result.current.isDone).toBe(true);
  });
});
