import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/shared/lib/api-client';
import { withIntl } from '@/shared/lib/test-i18n';

import type { AdminRefundsPageQuery } from '../admin-refunds-href';
import * as adminService from '../services/admin.service';
import type { AdminRefund, AdminRefundRequest, AdminRefundablePayment } from '../types';
import { AdminRefundsContainer } from './AdminRefundsContainer';

vi.mock('../services/admin.service', () => ({
  listRefundRequests: vi.fn(),
  decideRefundRequest: vi.fn(),
  listRefunds: vi.fn(),
  retryRefund: vi.fn(),
  markRefundCompleted: vi.fn(),
  listRefundablePayments: vi.fn(),
  refundPayment: vi.fn(),
}));

const toast = vi.hoisted(() => ({ success: vi.fn(), info: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

const ORDER_ID = '0f8fad5b-d9cb-469f-a165-70867728950e';

function request(id: string, overrides: Partial<AdminRefundRequest> = {}): AdminRefundRequest {
  return {
    id,
    kind: 'CANCEL',
    status: 'ESCALATED',
    reasonCode: 'CHANGE_OF_MIND',
    reasonNote: null,
    sellerRespondBy: '2026-10-03T03:00:00.000Z',
    statusChangedAt: '2026-10-02T03:00:00.000Z',
    createdAt: '2026-10-01T03:00:00.000Z',
    history: [],
    canApprove: true,
    canReject: true,
    shop: { id: 'shop-1', name: `Shop ${id}` },
    buyer: { name: 'Nguyễn Văn A', email: 'a@example.com' },
    order: {
      id: ORDER_ID,
      status: 'CONFIRMED',
      totalAmount: '320000',
      recipientName: 'Trần Thị B',
      items: [
        {
          productName: 'Áo thun',
          variantLabel: null,
          sku: 'AT-01',
          imageUrl: null,
          quantity: 1,
          priceAtPurchase: '320000',
        },
      ],
      itemCount: 1,
      paymentMethod: 'VNPAY',
      paymentStatus: 'SUCCESS',
      refund: null,
    },
    ...overrides,
  };
}

function refund(id: string, overrides: Partial<AdminRefund> = {}): AdminRefund {
  return {
    id,
    status: 'FAILED',
    amount: '320000',
    attempts: 3,
    reason: null,
    failureReason: 'Gateway rejected',
    gatewayRef: null,
    initiatedByType: 'SYSTEM',
    createdAt: '2026-10-01T03:00:00.000Z',
    updatedAt: '2026-10-02T03:00:00.000Z',
    completedAt: null,
    canRetry: true,
    canMarkCompleted: true,
    payment: {
      id: 'payment-1',
      method: 'VNPAY',
      status: 'SUCCESS',
      amount: '320000',
      refundedAmount: '0',
      txnRef: `TXN-${id}`,
      transactionId: '14883201',
    },
    order: {
      id: ORDER_ID,
      status: 'CANCELLED',
      totalAmount: '320000',
      recipientName: 'Trần Thị B',
    },
    buyer: { name: 'Nguyễn Văn A', email: 'a@example.com' },
    ...overrides,
  };
}

function payment(
  id: string,
  overrides: Partial<AdminRefundablePayment> = {},
): AdminRefundablePayment {
  return {
    id,
    kind: 'PAID_AFTER_EXPIRY',
    method: 'VNPAY',
    amount: '320000',
    paidAt: '2026-10-03T03:00:00.000Z',
    txnRef: `TXN-${id}`,
    transactionId: '14883201',
    checkoutGroupId: 'group-1',
    buyer: { name: 'Nguyễn Văn A', email: 'a@example.com' },
    orders: [{ id: ORDER_ID, status: 'CANCELLED', totalAmount: '320000' }],
    ...overrides,
  };
}

const page = <T,>(items: T[], total = items.length) => ({ items, total, page: 1, limit: 20 });

function setup(query: AdminRefundsPageQuery) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    withIntl(
      <QueryClientProvider client={queryClient}>
        <AdminRefundsContainer query={query} />
      </QueryClientProvider>,
    ),
  );
}

const DISPUTES: AdminRefundsPageQuery = { tab: 'disputes', status: 'ESCALATED', page: 1 };
const FAILED: AdminRefundsPageQuery = { tab: 'failed', status: 'NEEDS_ACTION', page: 1 };
const PAYMENTS: AdminRefundsPageQuery = { tab: 'payments', page: 1 };

beforeEach(() => {
  // Mọi hàm service và toast đều là mock của file này: reset sạch cả lệnh gọi lẫn cách trả giá trị giữa các test.
  vi.resetAllMocks();
});

describe('AdminRefundsContainer — khung chung', () => {
  it('luôn có hàng tab; tab đang xem được đánh dấu', async () => {
    vi.mocked(adminService.listRefundRequests).mockResolvedValue(page([]));
    setup(DISPUTES);

    const nav = screen.getByRole('navigation', { name: 'Các màn hoàn tiền' });
    expect(within(nav).getByRole('link', { name: 'Khiếu nại' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await screen.findByText('Không có khiếu nại nào đang chờ sàn xử lý.');
  });

  it('chỉ tab đang xem gọi API của nó (không bắn ba truy vấn cùng lúc)', async () => {
    vi.mocked(adminService.listRefunds).mockResolvedValue(page([]));
    setup(FAILED);

    await screen.findByText('Không có khoản hoàn nào cần xử lý.');
    expect(adminService.listRefunds).toHaveBeenCalledTimes(1);
    expect(adminService.listRefundRequests).not.toHaveBeenCalled();
    expect(adminService.listRefundablePayments).not.toHaveBeenCalled();
  });

  it('bộ lọc con chỉ có ở tab khiếu nại và tab hoàn tiền lỗi, tab thanh toán không có', async () => {
    vi.mocked(adminService.listRefundablePayments).mockResolvedValue(page([]));
    setup(PAYMENTS);

    await screen.findByText('Không có thanh toán bất thường nào cần hoàn.');
    expect(screen.queryByRole('navigation', { name: /Lọc/ })).not.toBeInTheDocument();
  });
});

describe('AdminRefundsContainer — tab Khiếu nại', () => {
  it('gọi API với bộ lọc + trang đang xem', async () => {
    vi.mocked(adminService.listRefundRequests).mockResolvedValue(page([]));
    setup({ tab: 'disputes', status: 'PENDING_SELLER', page: 2 });

    await waitFor(() =>
      expect(adminService.listRefundRequests).toHaveBeenCalledWith({
        status: 'PENDING_SELLER',
        page: 2,
      }),
    );
  });

  it('loading: aria-busy + sr-only; lỗi lần đầu: role=alert + "Thử lại" tải lại được', async () => {
    const user = userEvent.setup();
    vi.mocked(adminService.listRefundRequests)
      .mockRejectedValueOnce(new ApiError('Forbidden', 403))
      .mockResolvedValue(page([request('request-1')]));
    const { container } = setup(DISPUTES);

    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(await screen.findByRole('alert')).toHaveTextContent('Không tải được danh sách');
    await user.click(screen.getByRole('button', { name: 'Thử lại' }));

    expect(await screen.findByText('Shop request-1')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('rỗng ở bộ lọc "Chờ shop (ghi đè)": câu riêng của bộ lọc đó', async () => {
    vi.mocked(adminService.listRefundRequests).mockResolvedValue(page([]));
    setup({ tab: 'disputes', status: 'PENDING_SELLER', page: 1 });

    expect(
      await screen.findByText('Không có yêu cầu nào đang chờ shop phản hồi.'),
    ).toBeInTheDocument();
  });

  it('duyệt yêu cầu TRẢ HÀNG: hộp thoại nhắc hàng chưa tự cộng vào kho; xác nhận mới gọi API (ghi chú trống = undefined), rồi toast', async () => {
    const user = userEvent.setup();
    vi.mocked(adminService.listRefundRequests).mockResolvedValue(
      page([request('request-1', { kind: 'RETURN', reasonCode: 'DAMAGED' })]),
    );
    vi.mocked(adminService.decideRefundRequest).mockResolvedValue({} as never);
    setup(DISPUTES);

    await user.click(await screen.findByRole('button', { name: /Chấp thuận yêu cầu/ }));
    const dialog = await screen.findByRole('alertdialog');
    expect(
      within(dialog).getByText(/KHÔNG tự động được cộng lại vào kho của shop/),
    ).toBeInTheDocument();
    expect(adminService.decideRefundRequest).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: 'Chấp thuận' }));

    await waitFor(() =>
      expect(adminService.decideRefundRequest).toHaveBeenCalledWith('request-1', {
        decision: 'APPROVE',
        note: undefined,
      }),
    );
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Đã chấp thuận yêu cầu'));
  });

  it('từ chối: hộp thoại BẮT BUỘC lý do — để trống không gọi API, nhập rồi mới gọi kèm ghi chú', async () => {
    const user = userEvent.setup();
    vi.mocked(adminService.listRefundRequests).mockResolvedValue(page([request('request-1')]));
    vi.mocked(adminService.decideRefundRequest).mockResolvedValue({} as never);
    setup(DISPUTES);

    await user.click(await screen.findByRole('button', { name: /Từ chối yêu cầu/ }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Từ chối yêu cầu' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Vui lòng nhập lý do');
    expect(adminService.decideRefundRequest).not.toHaveBeenCalled();

    await user.type(within(dialog).getByLabelText('Lý do từ chối'), 'Thiếu bằng chứng');
    await user.click(within(dialog).getByRole('button', { name: 'Từ chối yêu cầu' }));

    await waitFor(() =>
      expect(adminService.decideRefundRequest).toHaveBeenCalledWith('request-1', {
        decision: 'REJECT',
        note: 'Thiếu bằng chứng',
      }),
    );
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Đã từ chối yêu cầu'));
  });

  it('409 (shop/người mua vừa xử lý): lỗi đã dịch ở đầu danh sách, không toast thành công', async () => {
    const user = userEvent.setup();
    vi.mocked(adminService.listRefundRequests).mockResolvedValue(page([request('request-1')]));
    vi.mocked(adminService.decideRefundRequest).mockRejectedValue(
      new ApiError('x', 409, 'REFUND_REQUEST_INVALID_TRANSITION'),
    );
    setup(DISPUTES);

    await user.click(await screen.findByRole('button', { name: /Chấp thuận yêu cầu/ }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Chấp thuận' }));

    expect(
      await screen.findByText('Yêu cầu vừa được cập nhật, vui lòng tải lại trang'),
    ).toBeInTheDocument();
    expect(toast.success).not.toHaveBeenCalled();
  });
});

describe('AdminRefundsContainer — tab Hoàn tiền lỗi', () => {
  it('thử lại qua hộp thoại xác nhận: bấm nút CHƯA gọi API; xác nhận mới gọi đúng khoản, kết quả PENDING -> toast info chứ không báo thành công', async () => {
    const user = userEvent.setup();
    vi.mocked(adminService.listRefunds).mockResolvedValue(page([refund('refund-1')]));
    vi.mocked(adminService.retryRefund).mockResolvedValue(
      refund('refund-1', { status: 'PENDING' }),
    );
    setup(FAILED);

    await user.click(await screen.findByRole('button', { name: /^Thử lại/ }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Thử lại hoàn tiền?')).toBeInTheDocument();
    expect(adminService.retryRefund).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: 'Thử lại' }));

    await waitFor(() => expect(adminService.retryRefund).toHaveBeenCalledWith('refund-1'));
    await waitFor(() =>
      expect(toast.info).toHaveBeenCalledWith('Khoản hoàn đang chờ cổng phản hồi'),
    );
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('"Quay lại" ở hộp thoại thử lại KHÔNG gọi API', async () => {
    const user = userEvent.setup();
    vi.mocked(adminService.listRefunds).mockResolvedValue(page([refund('refund-1')]));
    setup(FAILED);

    await user.click(await screen.findByRole('button', { name: /^Thử lại/ }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Quay lại' }));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(adminService.retryRefund).not.toHaveBeenCalled();
  });

  it('thử lại mà cổng vẫn từ chối (200, FAILED) -> toast error', async () => {
    const user = userEvent.setup();
    vi.mocked(adminService.listRefunds).mockResolvedValue(page([refund('refund-1')]));
    vi.mocked(adminService.retryRefund).mockResolvedValue(refund('refund-1', { status: 'FAILED' }));
    setup(FAILED);

    await user.click(await screen.findByRole('button', { name: /^Thử lại/ }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Thử lại' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('ghi nhận hoàn tay: hộp thoại cảnh báo + mã tham chiếu BẮT BUỘC; có mã mới gọi API', async () => {
    const user = userEvent.setup();
    vi.mocked(adminService.listRefunds).mockResolvedValue(page([refund('refund-1')]));
    vi.mocked(adminService.markRefundCompleted).mockResolvedValue(
      refund('refund-1', { status: 'SUCCEEDED' }),
    );
    setup(FAILED);

    await user.click(await screen.findByRole('button', { name: /^Ghi nhận hoàn tay/ }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/mất tiền thật/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Ghi nhận đã hoàn' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Vui lòng nhập mã tham chiếu khoản hoàn',
    );
    expect(adminService.markRefundCompleted).not.toHaveBeenCalled();

    await user.type(within(dialog).getByLabelText('Mã tham chiếu của giao dịch hoàn'), 'VNP-8841');
    await user.click(within(dialog).getByRole('button', { name: 'Ghi nhận đã hoàn' }));

    await waitFor(() =>
      expect(adminService.markRefundCompleted).toHaveBeenCalledWith('refund-1', {
        reference: 'VNP-8841',
      }),
    );
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Đã hoàn tiền thành công'));
  });

  it('khoản không còn thử lại được (cờ tắt) -> không nút nào; tab lịch sử "Đã hoàn" hiển thị được', async () => {
    vi.mocked(adminService.listRefunds).mockResolvedValue(
      page([refund('refund-1', { status: 'SUCCEEDED', canRetry: false, canMarkCompleted: false })]),
    );
    setup({ tab: 'failed', status: 'SUCCEEDED', page: 1 });

    const list = await screen.findByRole('list', { name: 'Danh sách khoản hoàn tiền' });
    expect(within(list).queryByRole('button')).not.toBeInTheDocument();
    expect(adminService.listRefunds).toHaveBeenCalledWith({ status: 'SUCCEEDED', page: 1 });
  });

  it('nhiều trang: phân trang giữ tab + bộ lọc', async () => {
    vi.mocked(adminService.listRefunds).mockResolvedValue(page([refund('refund-1')], 45));
    setup({ tab: 'failed', status: 'FAILED', page: 1 });

    expect(await screen.findByText('Trang 1 / 3')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Trang sau' })).toHaveAttribute(
      'href',
      '/admin/refunds?tab=failed&status=FAILED&page=2',
    );
  });
});

describe('AdminRefundsContainer — tab Thanh toán cần hoàn', () => {
  it('hiện thanh toán bất thường; "Hoàn tiền" mở hộp thoại xác nhận, lý do tuỳ chọn, rồi gọi API', async () => {
    const user = userEvent.setup();
    vi.mocked(adminService.listRefundablePayments).mockResolvedValue(page([payment('payment-1')]));
    vi.mocked(adminService.refundPayment).mockResolvedValue(
      refund('refund-9', { status: 'SUCCEEDED' }),
    );
    setup(PAYMENTS);

    await user.click(await screen.findByRole('button', { name: /^Hoàn tiền/ }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/Không thể hoàn tác/)).toBeInTheDocument();
    expect(adminService.refundPayment).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: 'Hoàn tiền' }));

    await waitFor(() =>
      expect(adminService.refundPayment).toHaveBeenCalledWith('payment-1', { reason: undefined }),
    );
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Đã hoàn tiền thành công'));
  });

  it('409 PAYMENT_NOT_REFUNDABLE (Admin khác vừa hoàn): lỗi đã dịch, không toast thành công', async () => {
    const user = userEvent.setup();
    vi.mocked(adminService.listRefundablePayments).mockResolvedValue(page([payment('payment-1')]));
    vi.mocked(adminService.refundPayment).mockRejectedValue(
      new ApiError('x', 409, 'PAYMENT_NOT_REFUNDABLE'),
    );
    setup(PAYMENTS);

    await user.click(await screen.findByRole('button', { name: /^Hoàn tiền/ }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Hoàn tiền' }));

    await waitFor(() => expect(screen.getAllByRole('alert').length).toBeGreaterThan(0));
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('gọi API theo trang đang xem', async () => {
    vi.mocked(adminService.listRefundablePayments).mockResolvedValue(page([]));
    setup({ tab: 'payments', page: 3 });

    await waitFor(() =>
      expect(adminService.listRefundablePayments).toHaveBeenCalledWith({ page: 3 }),
    );
  });
});
