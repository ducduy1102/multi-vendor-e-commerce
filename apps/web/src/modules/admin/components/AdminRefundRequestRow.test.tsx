import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import type { AdminRefundRequest } from '../types';
import {
  ADMIN_REFUND_FIELD_LABEL_CLASS,
  ADMIN_REFUND_GRID_CLASS,
} from './admin-refund-row.constants';
import { AdminRefundRequestRow } from './AdminRefundRequestRow';

const ORDER_ID = '0f8fad5b-d9cb-469f-a165-70867728950e';

function item(overrides: Partial<AdminRefundRequest> = {}): AdminRefundRequest {
  return {
    id: 'request-1',
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
    shop: { id: 'shop-1', name: 'Shop Áo Xinh' },
    buyer: { name: 'Nguyễn Văn A', email: 'a@example.com' },
    order: {
      id: ORDER_ID,
      status: 'CONFIRMED',
      totalAmount: '320000',
      recipientName: 'Trần Thị B',
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
      paymentMethod: 'VNPAY',
      paymentStatus: 'SUCCESS',
      refund: null,
    },
    ...overrides,
  };
}

function setup(overrides: Partial<AdminRefundRequest> = {}, isDisabled = false) {
  const onApprove = vi.fn();
  const onReject = vi.fn();
  const utils = render(
    withIntl(
      <ul>
        <AdminRefundRequestRow
          request={item(overrides)}
          isDisabled={isDisabled}
          onApprove={onApprove}
          onReject={onReject}
        />
      </ul>,
    ),
  );
  return { ...utils, onApprove, onReject };
}

describe('AdminRefundRequestRow — cột yêu cầu', () => {
  it('loại yêu cầu + lý do của người mua (nhãn dùng chung với phía người mua/shop)', () => {
    setup({ reasonCode: 'FOUND_CHEAPER' });

    expect(screen.getByText('Yêu cầu hủy đơn')).toBeInTheDocument();
    expect(screen.getByText('Tìm được nơi bán rẻ hơn')).toBeInTheDocument();
  });

  it('yêu cầu trả hàng có tiêu đề riêng', () => {
    setup({ kind: 'RETURN', reasonCode: 'DAMAGED' });

    expect(screen.getByText('Yêu cầu trả hàng/hoàn tiền')).toBeInTheDocument();
    expect(screen.getByText('Hàng bị hư hỏng, vỡ')).toBeInTheDocument();
  });

  it('mã lý do BE thêm sau mà FE chưa biết -> "Lý do khác", không lộ mã thô', () => {
    setup({ reasonCode: 'SOME_FUTURE_REASON' });

    expect(screen.getByText('Lý do khác')).toBeInTheDocument();
    expect(screen.queryByText(/SOME_FUTURE_REASON/)).not.toBeInTheDocument();
  });

  it('mô tả của người mua và LÝ DO SHOP TỪ CHỐI (lấy từ lịch sử) hiện cạnh nhau để Admin quyết định', () => {
    setup({
      reasonNote: 'Áo bị rách tay',
      history: [
        {
          toStatus: 'PENDING_SELLER',
          actorType: 'BUYER',
          note: null,
          createdAt: '2026-10-01T03:00:00.000Z',
        },
        {
          toStatus: 'REJECTED_BY_SELLER',
          actorType: 'SELLER',
          note: 'Hàng đã giao đúng mẫu',
          createdAt: '2026-10-01T05:00:00.000Z',
        },
        {
          toStatus: 'ESCALATED',
          actorType: 'BUYER',
          note: null,
          createdAt: '2026-10-02T03:00:00.000Z',
        },
      ],
    });

    expect(screen.getByText('Mô tả của người mua: Áo bị rách tay')).toBeInTheDocument();
    expect(screen.getByText('Lý do shop từ chối: Hàng đã giao đúng mẫu')).toBeInTheDocument();
  });

  it('shop chưa từ chối / không mô tả -> không có hai dòng đó', () => {
    setup({ reasonNote: null, history: [] });

    expect(screen.queryByText(/Mô tả của người mua/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Lý do shop từ chối/)).not.toBeInTheDocument();
  });

  it('có tên + email người mua (Admin cần để liên hệ)', () => {
    setup();

    expect(screen.getByText('Nguyễn Văn A · a@example.com')).toBeInTheDocument();
  });
});

describe('AdminRefundRequestRow — cột đơn hàng', () => {
  it('shop, mã rút gọn + người nhận, sản phẩm đầu, cách thanh toán + trạng thái đơn, tổng tiền', () => {
    setup();

    expect(screen.getByText('Shop Áo Xinh')).toBeInTheDocument();
    expect(screen.getByText('Đơn #0f8fad5b · Trần Thị B')).toBeInTheDocument();
    expect(screen.getByText('Áo thun cổ tròn')).toBeInTheDocument();
    expect(screen.getByText('VNPay · Đã xác nhận')).toBeInTheDocument();
    expect(screen.getByText(/320\.000/)).toBeInTheDocument();
  });

  it('đơn nhiều sản phẩm: "và N sản phẩm khác" với N = tổng - 1', () => {
    setup({ order: { ...item().order, itemCount: 4 } });

    expect(screen.getByText(/Áo thun cổ tròn và 3 sản phẩm khác/)).toBeInTheDocument();
  });

  it('không có phương thức thanh toán -> chỉ còn trạng thái đơn, không dấu "·" thừa', () => {
    setup({ order: { ...item().order, paymentMethod: null } });

    expect(screen.getByText('Đã xác nhận')).toBeInTheDocument();
  });

  it('đơn đã có khoản hoàn -> hiện trạng thái + số tiền khoản hoàn', () => {
    setup({ order: { ...item().order, refund: { status: 'FAILED', amount: '320000' } } });

    expect(screen.getByText(/Khoản hoàn: Hoàn tiền lỗi/)).toHaveTextContent('320.000');
  });

  it('đơn chưa có khoản hoàn -> không có dòng khoản hoàn', () => {
    setup();

    expect(screen.queryByText(/Khoản hoàn:/)).not.toBeInTheDocument();
  });
});

describe('AdminRefundRequestRow — trạng thái và mốc thời gian', () => {
  it('đã lên sàn: huy hiệu "Chờ sàn xử lý" + "Lên sàn lúc <ngày giờ>"', () => {
    setup({ status: 'ESCALATED' });

    expect(screen.getByText('Chờ sàn xử lý')).toBeInTheDocument();
    expect(screen.getByText(/Lên sàn lúc .*2026/)).toBeInTheDocument();
  });

  it('còn chờ shop (Admin ghi đè): huy hiệu "Chờ shop phản hồi" + HẠN shop phản hồi', () => {
    setup({ status: 'PENDING_SELLER' });

    expect(screen.getByText('Chờ shop phản hồi')).toBeInTheDocument();
    expect(screen.getByText(/Hạn shop phản hồi: .*2026/)).toBeInTheDocument();
  });

  it.each([
    ['APPROVED', 'Đã chấp thuận'],
    ['REJECTED', 'Sàn đã từ chối'],
    ['REJECTED_BY_SELLER', 'Shop đã từ chối'],
    ['WITHDRAWN', 'Người mua đã rút'],
  ] as const)('trạng thái %s: huy hiệu "%s" + "Cập nhật <ngày giờ>"', (status, label) => {
    setup({ status, canApprove: false, canReject: false });

    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.getByText(/Cập nhật .*2026/)).toBeInTheDocument();
  });
});

describe('AdminRefundRequestRow — thao tác chỉ theo cờ của BE', () => {
  it('canApprove + canReject -> hai nút, bấm gọi đúng callback', async () => {
    const user = userEvent.setup();
    const { onApprove, onReject } = setup();

    await user.click(screen.getByRole('button', { name: /Chấp thuận yêu cầu/ }));
    await user.click(screen.getByRole('button', { name: /Từ chối yêu cầu/ }));

    expect(onApprove).toHaveBeenCalledTimes(1);
    expect(onReject).toHaveBeenCalledTimes(1);
  });

  it('nút có tên truy cập kèm shop + mã đơn (nhiều dòng cùng nút, trình đọc màn hình cần biết nút nào của dòng nào)', () => {
    setup();

    expect(
      screen.getByRole('button', { name: 'Chấp thuận yêu cầu: Shop Áo Xinh #0f8fad5b' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Từ chối yêu cầu: Shop Áo Xinh #0f8fad5b' }),
    ).toBeInTheDocument();
  });

  it('"Chấp thuận" là nút chính (primary), "Từ chối" là outline — không nút nào đỏ hay cam', () => {
    setup();

    expect(screen.getByRole('button', { name: /Chấp thuận yêu cầu/ })).toHaveClass('bg-primary');
    const reject = screen.getByRole('button', { name: /Từ chối yêu cầu/ });
    expect(reject).toHaveClass('border-border');
    expect(reject).not.toHaveClass('bg-destructive/10');
  });

  it('không cờ nào (đã xử lý, hoặc yêu cầu TRẢ HÀNG còn chờ shop mà Admin chưa ghi đè được) -> không nút nào', () => {
    setup({ status: 'APPROVED', canApprove: false, canReject: false });

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('chỉ canApprove -> chỉ "Chấp thuận"; chỉ canReject -> chỉ "Từ chối" (hai cờ độc lập, không suy từ nhau)', () => {
    const { unmount } = setup({ canApprove: true, canReject: false });
    expect(screen.getByRole('button', { name: /Chấp thuận yêu cầu/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Từ chối yêu cầu/ })).not.toBeInTheDocument();
    unmount();

    setup({ canApprove: false, canReject: true });
    expect(screen.getByRole('button', { name: /Từ chối yêu cầu/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Chấp thuận yêu cầu/ })).not.toBeInTheDocument();
  });

  it('đang có hành động chạy -> khoá cả hai nút, bấm không gọi callback', async () => {
    const user = userEvent.setup();
    const { onApprove, onReject } = setup({}, true);

    for (const button of screen.getAllByRole('button')) {
      expect(button).toBeDisabled();
      await user.click(button);
    }

    expect(onApprove).not.toHaveBeenCalled();
    expect(onReject).not.toHaveBeenCalled();
  });
});

describe('AdminRefundRequestRow — bố cục (một markup duy nhất, dùng chung lưới với tiêu đề)', () => {
  it('dòng dùng đúng hằng số lưới dùng chung, có cột ngầm định co được ở mobile', () => {
    setup();

    const row = screen.getByRole('listitem');
    for (const cls of ADMIN_REFUND_GRID_CLASS.split(' ')) expect(row).toHaveClass(cls);
    expect(row).toHaveClass('grid-cols-1');
  });

  it('mỗi trường có nhãn: hiện ở mobile, chỉ còn cho trình đọc màn hình ở desktop (md:sr-only)', () => {
    setup();

    const row = screen.getByRole('listitem');
    for (const name of ['Yêu cầu', 'Đơn hàng', 'Trạng thái']) {
      const label = within(row).getByText(name, { selector: 'span' });
      for (const cls of ADMIN_REFUND_FIELD_LABEL_CLASS.split(' ')) expect(label).toHaveClass(cls);
    }
  });

  it('chữ do người dùng nhập (mô tả, lý do shop, tên) cắt dòng/ngắt chữ, không đẩy bảng rộng ra', () => {
    setup({
      reasonNote: 'a'.repeat(500),
      shop: { id: 'shop-1', name: 'S'.repeat(300) },
      buyer: { name: 'N'.repeat(100), email: `${'e'.repeat(200)}@example.com` },
      history: [
        {
          toStatus: 'REJECTED_BY_SELLER',
          actorType: 'SELLER',
          note: 'b'.repeat(500),
          createdAt: '2026-10-01T05:00:00.000Z',
        },
      ],
    });

    expect(screen.getByText(`Mô tả của người mua: ${'a'.repeat(500)}`)).toHaveClass(
      'line-clamp-2',
      'break-words',
      'whitespace-pre-line',
    );
    expect(screen.getByText(`Lý do shop từ chối: ${'b'.repeat(500)}`)).toHaveClass(
      'line-clamp-2',
      'break-words',
    );
    expect(screen.getByText('S'.repeat(300))).toHaveClass('truncate');
  });

  it('cột thao tác có độ rộng cố định, KHÔNG dùng auto (tiêu đề không lệch khỏi dữ liệu)', () => {
    expect(ADMIN_REFUND_GRID_CLASS).toMatch(/_11rem\]/);
    expect(ADMIN_REFUND_GRID_CLASS).not.toMatch(/auto/);
  });
});
