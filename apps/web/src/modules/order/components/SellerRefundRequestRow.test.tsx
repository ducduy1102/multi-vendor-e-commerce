import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import type { SellerRefundRequestListItem } from '../types';
import {
  SELLER_REFUND_FIELD_LABEL_CLASS,
  SELLER_REFUND_GRID_CLASS,
} from './seller-refund-request-row.constants';
import { SellerRefundRequestRow } from './SellerRefundRequestRow';

const ORDER_ID = '0f8fad5b-d9cb-469f-a165-70867728950e';

function item(overrides: Partial<SellerRefundRequestListItem> = {}): SellerRefundRequestListItem {
  return {
    id: 'request-1',
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
      id: ORDER_ID,
      status: 'CONFIRMED',
      totalAmount: '320000',
      recipientName: 'Nguyễn Văn A',
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
    },
    ...overrides,
  };
}

function setup(overrides: Partial<SellerRefundRequestListItem> = {}, isDisabled = false) {
  const onApprove = vi.fn();
  const onReject = vi.fn();
  const utils = render(
    withIntl(
      <ul>
        <SellerRefundRequestRow
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

describe('SellerRefundRequestRow — nội dung', () => {
  it('cột yêu cầu: loại yêu cầu + lý do của người mua', () => {
    setup({ reasonCode: 'FOUND_CHEAPER' });

    expect(screen.getByText('Yêu cầu hủy đơn')).toBeInTheDocument();
    expect(screen.getByText('Tìm được nơi bán rẻ hơn')).toBeInTheDocument();
  });

  it('cột đơn hàng: người nhận, mã rút gọn, sản phẩm đầu, cách thanh toán, tổng tiền (đủ để quyết định mà không mở đơn)', () => {
    setup();

    expect(screen.getByText('Nguyễn Văn A')).toBeInTheDocument();
    expect(screen.getByText('Mã #0f8fad5b')).toBeInTheDocument();
    expect(screen.getByText('Áo thun cổ tròn')).toBeInTheDocument();
    expect(screen.getByText(/VNPay/)).toBeInTheDocument();
    expect(screen.getByText(/320\.000/)).toBeInTheDocument();
  });

  it('đơn nhiều sản phẩm: tên sản phẩm đầu + "và N sản phẩm khác" (N = tổng - 1)', () => {
    setup({ order: { ...item().order, itemCount: 4 } });

    expect(screen.getByText(/Áo thun cổ tròn và 3 sản phẩm khác/)).toBeInTheDocument();
  });

  it('đơn không có thông tin thanh toán -> không có dòng thanh toán trống', () => {
    setup({ order: { ...item().order, paymentMethod: null, paymentStatus: null } });

    expect(screen.queryByText(/VNPay/)).not.toBeInTheDocument();
  });

  it('mô tả của người mua có hiện, cắt 2 dòng bằng CSS và ngắt được chuỗi dài', () => {
    setup({ reasonNote: 'a'.repeat(500) });

    const note = screen.getByText('a'.repeat(500));
    expect(note).toHaveClass('line-clamp-2', 'break-words', 'whitespace-pre-line');
  });

  it('không có mô tả -> không render dòng mô tả', () => {
    const { container } = setup({ reasonNote: null });

    expect(container.querySelector('.line-clamp-2')).toBeNull();
  });
});

describe('SellerRefundRequestRow — trạng thái và hạn phản hồi', () => {
  it('chờ shop: huy hiệu + HẠN phản hồi + hệ quả quá hạn', () => {
    setup();

    expect(screen.getByText('Chờ shop phản hồi')).toBeInTheDocument();
    expect(screen.getByText(/Hạn phản hồi: .*2026/)).toBeInTheDocument();
    expect(screen.getByText(/đơn sẽ tự động bị hủy/)).toBeInTheDocument();
  });

  it('yêu cầu trả hàng chờ shop: hệ quả quá hạn là chuyển lên sàn', () => {
    setup({ kind: 'RETURN', reasonCode: 'DAMAGED' });

    expect(screen.getByText('Yêu cầu trả hàng/hoàn tiền')).toBeInTheDocument();
    expect(screen.getByText(/chuyển lên sàn xử lý/)).toBeInTheDocument();
  });

  it('đã xử lý: huy hiệu kết quả + "Cập nhật <ngày>" thay cho hạn phản hồi', () => {
    setup({ status: 'APPROVED', canApprove: false, canReject: false });

    expect(screen.getByText('Đã chấp thuận')).toBeInTheDocument();
    expect(screen.getByText(/Cập nhật .*2026/)).toBeInTheDocument();
    expect(screen.queryByText(/Hạn phản hồi/)).not.toBeInTheDocument();
  });
});

describe('SellerRefundRequestRow — thao tác chỉ theo cờ của BE', () => {
  it('canApprove + canReject -> hai nút và link "Xem đơn" tới chi tiết đơn', async () => {
    const user = userEvent.setup();
    const { onApprove, onReject } = setup();

    await user.click(screen.getByRole('button', { name: 'Chấp thuận yêu cầu' }));
    await user.click(screen.getByRole('button', { name: 'Từ chối yêu cầu' }));

    expect(onApprove).toHaveBeenCalledTimes(1);
    expect(onReject).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('link', { name: 'Xem đơn' })).toHaveAttribute(
      'href',
      `/seller/orders/${ORDER_ID}`,
    );
  });

  it('đã xử lý (không cờ) -> KHÔNG nút nào, chỉ còn link "Xem đơn"', () => {
    setup({ status: 'REJECTED_BY_SELLER', canApprove: false, canReject: false });

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Xem đơn' })).toBeInTheDocument();
  });

  it('chỉ canApprove (yêu cầu hủy đã lên sàn) -> chỉ nút "Chấp thuận yêu cầu"', () => {
    setup({ status: 'ESCALATED', canApprove: true, canReject: false });

    expect(screen.getByRole('button', { name: 'Chấp thuận yêu cầu' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Từ chối yêu cầu' })).not.toBeInTheDocument();
  });

  it('chỉ canReject (cờ độc lập) -> chỉ nút "Từ chối yêu cầu", không có "Chấp thuận yêu cầu"', () => {
    setup({ canApprove: false, canReject: true });

    expect(screen.getByRole('button', { name: 'Từ chối yêu cầu' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Chấp thuận yêu cầu' })).not.toBeInTheDocument();
  });

  it('đang có hành động chạy -> khoá hai nút, bấm không gọi callback; link vẫn dùng được', async () => {
    const user = userEvent.setup();
    const { onApprove, onReject } = setup({}, true);

    for (const button of screen.getAllByRole('button')) {
      expect(button).toBeDisabled();
      await user.click(button);
    }

    expect(onApprove).not.toHaveBeenCalled();
    expect(onReject).not.toHaveBeenCalled();
    expect(screen.getByRole('link', { name: 'Xem đơn' })).toBeInTheDocument();
  });
});

describe('SellerRefundRequestRow — bố cục (một markup duy nhất, dùng chung template cột với tiêu đề)', () => {
  it('dòng dùng đúng hằng số lưới dùng chung với tiêu đề/skeleton, có cột ngầm định co được ở mobile', () => {
    setup();

    const row = screen.getByRole('listitem');
    for (const cls of SELLER_REFUND_GRID_CLASS.split(' ')) expect(row).toHaveClass(cls);
    expect(row).toHaveClass('grid-cols-1');
  });

  it('cột thao tác có độ rộng cố định, KHÔNG dùng auto (tiêu đề không lệch khỏi dữ liệu)', () => {
    expect(SELLER_REFUND_GRID_CLASS).toMatch(/_11rem\]/);
    expect(SELLER_REFUND_GRID_CLASS).not.toMatch(/auto/);
  });

  it('mỗi trường có nhãn: hiện ở mobile, chỉ còn cho trình đọc màn hình ở desktop (md:sr-only)', () => {
    setup();

    const row = screen.getByRole('listitem');
    for (const name of ['Yêu cầu', 'Đơn hàng', 'Trạng thái', 'Thao tác']) {
      const label = within(row).getByText(name, { selector: 'span' });
      for (const cls of SELLER_REFUND_FIELD_LABEL_CLASS.split(' ')) expect(label).toHaveClass(cls);
    }
  });

  it('tên người nhận dài không dấu cách bị cắt (truncate) trong cột co được, không đẩy bảng rộng ra', () => {
    setup({ order: { ...item().order, recipientName: 'N'.repeat(300) } });

    expect(screen.getByText('N'.repeat(300))).toHaveClass('truncate');
  });
});
