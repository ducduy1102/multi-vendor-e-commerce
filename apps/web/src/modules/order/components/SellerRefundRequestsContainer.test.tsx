import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/shared/lib/api-client';
import { withIntl } from '@/shared/lib/test-i18n';

import * as orderService from '../services/order.service';
import type { SellerRefundRequestListItem, SellerRefundRequestListResponse } from '../types';
import type { SellerRefundRequestFilter } from '../refund-requests-href';
import { SellerRefundRequestsContainer } from './SellerRefundRequestsContainer';

vi.mock('../services/order.service', () => ({
  listSellerRefundRequests: vi.fn(),
  approveRefundRequest: vi.fn(),
  rejectRefundRequest: vi.fn(),
}));

const { toastSuccess } = vi.hoisted(() => ({ toastSuccess: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: toastSuccess, error: vi.fn() } }));

const SHOP = 'shop-1';

function item(
  id: string,
  overrides: Partial<SellerRefundRequestListItem> = {},
): SellerRefundRequestListItem {
  return {
    id,
    kind: 'CANCEL',
    status: 'PENDING_SELLER',
    sellerRespondBy: '2026-10-03T03:00:00.000Z',
    reasonCode: 'CHANGE_OF_MIND',
    reasonNote: null,
    statusChangedAt: '2026-10-01T03:00:00.000Z',
    createdAt: '2026-10-01T03:00:00.000Z',
    history: [],
    canApprove: true,
    canReject: true,
    order: {
      id: `0f8fad5b-d9cb-469f-a165-70867728950${id.slice(-1)}`,
      status: 'CONFIRMED',
      totalAmount: '320000',
      recipientName: `Người nhận ${id}`,
      items: [
        {
          productName: 'Áo thun cổ tròn',
          variantLabel: 'Đen / M',
          sku: 'AT-01',
          imageUrl: null,
          quantity: 1,
          priceAtPurchase: '160000',
        },
      ],
      itemCount: 1,
      paymentMethod: 'COD',
      paymentStatus: 'PENDING',
    },
    ...overrides,
  };
}

const page = (
  items: SellerRefundRequestListItem[],
  total = items.length,
): SellerRefundRequestListResponse => ({ items, total, page: 1, limit: 20 });

function setup(filter: SellerRefundRequestFilter = 'PENDING_SELLER', pageNumber = 1) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    withIntl(
      <QueryClientProvider client={queryClient}>
        <SellerRefundRequestsContainer shopId={SHOP} filter={filter} page={pageNumber} />
      </QueryClientProvider>,
    ),
  );
}

describe('SellerRefundRequestsContainer', () => {
  beforeEach(() => {
    vi.mocked(orderService.listSellerRefundRequests).mockReset();
    vi.mocked(orderService.approveRefundRequest).mockReset();
    vi.mocked(orderService.rejectRefundRequest).mockReset();
    toastSuccess.mockReset();
  });

  it('đang tải: vùng aria-busy kèm dòng sr-only, skeleton trang trí; tiêu đề và tab vẫn hiện', () => {
    vi.mocked(orderService.listSellerRefundRequests).mockReturnValue(new Promise(() => undefined));
    const { container } = setup();

    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.getByText('Đang tải...')).toHaveClass('sr-only');
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
    expect(screen.getByRole('heading', { name: 'Yêu cầu hủy đơn & trả hàng' })).toBeInTheDocument();
    expect(
      screen.getByRole('navigation', { name: 'Lọc yêu cầu theo trạng thái' }),
    ).toBeInTheDocument();
  });

  it('lỗi tải lần đầu: thông báo có role=alert + nút "Thử lại" tải lại được', async () => {
    const user = userEvent.setup();
    vi.mocked(orderService.listSellerRefundRequests)
      .mockRejectedValueOnce(new ApiError('Forbidden', 403))
      .mockResolvedValue(page([item('request-1')]));
    setup();

    expect(await screen.findByRole('alert')).toHaveTextContent('Không tải được danh sách yêu cầu');
    await user.click(screen.getByRole('button', { name: 'Thử lại' }));

    expect(await screen.findByText('Người nhận request-1')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('rỗng ở tab "Chờ bạn phản hồi": câu riêng nói rằng không có việc nào đang chờ', async () => {
    vi.mocked(orderService.listSellerRefundRequests).mockResolvedValue(page([]));
    setup('PENDING_SELLER');

    expect(
      await screen.findByText('Không có yêu cầu nào đang chờ bạn phản hồi.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: /Danh sách yêu cầu/ })).not.toBeInTheDocument();
  });

  it('rỗng ở tab khác: câu chung theo trạng thái', async () => {
    vi.mocked(orderService.listSellerRefundRequests).mockResolvedValue(page([]));
    setup('APPROVED');

    expect(await screen.findByText('Không có yêu cầu nào ở trạng thái này.')).toBeInTheDocument();
  });

  it('có yêu cầu: bảng có tiêu đề cột (aria-hidden) + từng dòng, nút theo cờ của BE', async () => {
    vi.mocked(orderService.listSellerRefundRequests).mockResolvedValue(
      page([item('request-1'), item('request-2', { canApprove: false, canReject: false })]),
    );
    setup();

    const list = await screen.findByRole('list', { name: 'Danh sách yêu cầu hủy đơn và trả hàng' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByRole('button', { name: 'Chấp thuận yêu cầu' })).toBeInTheDocument();
    expect(within(rows[1]).queryByRole('button')).not.toBeInTheDocument();
    expect(within(rows[1]).getByRole('link', { name: 'Xem đơn' })).toBeInTheDocument();
  });

  it('tab đang xem được đánh dấu aria-current và đủ 6 tab', async () => {
    vi.mocked(orderService.listSellerRefundRequests).mockResolvedValue(page([]));
    setup('ESCALATED');

    const nav = screen.getByRole('navigation', { name: 'Lọc yêu cầu theo trạng thái' });
    expect(within(nav).getAllByRole('link')).toHaveLength(6);
    expect(within(nav).getByRole('link', { name: 'Đã khiếu nại' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(nav).getByRole('link', { name: 'Chờ bạn phản hồi' })).not.toHaveAttribute(
      'aria-current',
    );
    await screen.findByText('Không có yêu cầu nào ở trạng thái này.');
  });

  it.each([
    ['PENDING_SELLER', { status: 'PENDING_SELLER', page: 1 }],
    ['ESCALATED', { status: 'ESCALATED', page: 1 }],
    ['all', { status: undefined, page: 1 }],
  ] as const)(
    'bộ lọc %s -> gọi service với tham số status tương ứng ("Tất cả" = không gửi status)',
    async (filter, query) => {
      vi.mocked(orderService.listSellerRefundRequests).mockResolvedValue(page([]));
      setup(filter);

      await waitFor(() =>
        expect(orderService.listSellerRefundRequests).toHaveBeenCalledWith(SHOP, query),
      );
    },
  );

  it('nhiều trang: có phân trang, "Trang sau" giữ nguyên bộ lọc', async () => {
    vi.mocked(orderService.listSellerRefundRequests).mockResolvedValue(
      page([item('request-1')], 45),
    );
    setup('APPROVED');

    expect(await screen.findByText('Trang 1 / 3')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Trang sau' })).toHaveAttribute(
      'href',
      '/seller/refund-requests?status=APPROVED&page=2',
    );
  });

  it('duyệt yêu cầu TRẢ HÀNG: hộp thoại nhắc hàng chưa được tự cộng kho, xác nhận mới gọi service, rồi toast', async () => {
    const user = userEvent.setup();
    vi.mocked(orderService.listSellerRefundRequests).mockResolvedValue(
      page([item('request-1', { kind: 'RETURN', reasonCode: 'DAMAGED' })]),
    );
    vi.mocked(orderService.approveRefundRequest).mockResolvedValue({} as never);
    setup();

    await user.click(await screen.findByRole('button', { name: 'Chấp thuận yêu cầu' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/KHÔNG tự động được cộng lại vào kho/)).toBeInTheDocument();
    expect(orderService.approveRefundRequest).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: 'Chấp thuận' }));

    await waitFor(() =>
      expect(orderService.approveRefundRequest).toHaveBeenCalledWith(SHOP, 'request-1', {
        note: undefined,
      }),
    );
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Đã chấp thuận yêu cầu'));
  });

  it('duyệt yêu cầu HỦY: hộp thoại nói đơn bị hủy, KHÔNG có câu nhắc kho thủ công', async () => {
    const user = userEvent.setup();
    vi.mocked(orderService.listSellerRefundRequests).mockResolvedValue(page([item('request-1')]));
    setup();

    await user.click(await screen.findByRole('button', { name: 'Chấp thuận yêu cầu' }));

    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Chấp thuận yêu cầu hủy đơn?')).toBeInTheDocument();
    expect(within(dialog).queryByText(/KHÔNG tự động/)).not.toBeInTheDocument();
  });

  it('từ chối: hộp thoại BẮT BUỘC lý do — để trống không gọi service, nhập rồi mới gọi kèm ghi chú', async () => {
    const user = userEvent.setup();
    vi.mocked(orderService.listSellerRefundRequests).mockResolvedValue(page([item('request-1')]));
    vi.mocked(orderService.rejectRefundRequest).mockResolvedValue({} as never);
    setup();

    await user.click(await screen.findByRole('button', { name: 'Từ chối yêu cầu' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Từ chối yêu cầu' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Vui lòng nhập lý do');
    expect(orderService.rejectRefundRequest).not.toHaveBeenCalled();

    await user.type(within(dialog).getByLabelText('Lý do từ chối'), 'Hàng đã giao đúng mẫu');
    await user.click(within(dialog).getByRole('button', { name: 'Từ chối yêu cầu' }));

    await waitFor(() =>
      expect(orderService.rejectRefundRequest).toHaveBeenCalledWith(SHOP, 'request-1', {
        note: 'Hàng đã giao đúng mẫu',
      }),
    );
  });

  it('duyệt bị 409 (người mua vừa rút): thông báo lỗi đã dịch ở đầu danh sách, không toast thành công', async () => {
    const user = userEvent.setup();
    vi.mocked(orderService.listSellerRefundRequests).mockResolvedValue(page([item('request-1')]));
    vi.mocked(orderService.approveRefundRequest).mockRejectedValue(
      new ApiError('x', 409, 'REFUND_REQUEST_INVALID_TRANSITION'),
    );
    setup();

    await user.click(await screen.findByRole('button', { name: 'Chấp thuận yêu cầu' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Chấp thuận' }));

    expect(
      await screen.findByText('Yêu cầu vừa được cập nhật, vui lòng tải lại trang'),
    ).toBeInTheDocument();
    expect(toastSuccess).not.toHaveBeenCalled();
  });
});
