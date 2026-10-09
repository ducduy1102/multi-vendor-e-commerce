import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { formatPrice } from '@/modules/product';
import { withIntl } from '@/shared/lib/test-i18n';

import type { SellerOrderListItem } from '../types';
import { SellerOrderCard } from './SellerOrderCard';

// formatPrice (Intl) chèn NBSP trước "₫" còn getByText chỉ chuẩn hoá phía DOM — chuẩn hoá phía test.
const price = (value: string) => formatPrice(value).replace(/\s/g, ' ');

function order(overrides: Partial<SellerOrderListItem> = {}): SellerOrderListItem {
  return {
    id: 'abcdef12-3456-4789-8abc-def012345678',
    status: 'PENDING',
    createdAt: '2026-10-01T03:30:00.000Z',
    totalAmount: '320000',
    recipientName: 'Nguyễn Văn A',
    shippingProvince: 'TP. Hồ Chí Minh',
    items: [
      {
        productName: 'Áo thun nam',
        variantLabel: 'Đỏ / M',
        sku: 'AT-D-M',
        imageUrl: null,
        quantity: 2,
        priceAtPurchase: '150000',
      },
    ],
    itemCount: 1,
    paymentMethod: 'COD',
    paymentStatus: 'PENDING',
    canConfirm: true,
    canPack: false,
    canShip: false,
    canReject: true,
    canCancel: false,
    refundRequest: null,
    buyerNote: null,
    ...overrides,
  };
}

describe('SellerOrderCard', () => {
  it('đầu card: tên người nhận, mã đơn rút gọn (8 ký tự đầu), tỉnh/thành và trạng thái', () => {
    render(withIntl(<SellerOrderCard order={order()} />));

    expect(screen.getByRole('heading', { name: 'Nguyễn Văn A' })).toBeInTheDocument();
    expect(screen.getByText('Mã #abcdef12 · TP. Hồ Chí Minh')).toBeInTheDocument();
    expect(screen.getByText('Chờ xác nhận')).toBeInTheDocument();
  });

  it('dòng hàng: tên, phân loại, đơn giá, số lượng; tổng tiền định dạng VND', () => {
    render(withIntl(<SellerOrderCard order={order()} />));

    expect(screen.getByText('Áo thun nam')).toBeInTheDocument();
    expect(screen.getByText('Đỏ / M')).toBeInTheDocument();
    expect(screen.getByText(price('150000'))).toBeInTheDocument();
    expect(screen.getByText('×2')).toBeInTheDocument();
    expect(screen.getByText(price('320000'))).toBeInTheDocument();
  });

  it('đơn COD chưa giao: hiện "Thanh toán khi nhận hàng · Chưa thanh toán" để Seller biết còn phải thu tiền', () => {
    render(
      withIntl(
        <SellerOrderCard order={order({ paymentMethod: 'COD', paymentStatus: 'PENDING' })} />,
      ),
    );

    const summary = screen.getByText(/Đặt lúc/);
    expect(summary).toHaveTextContent('Thanh toán khi nhận hàng · Chưa thanh toán');
  });

  it('đơn đã trả online: "VNPay · Đã thanh toán"', () => {
    render(
      withIntl(
        <SellerOrderCard order={order({ paymentMethod: 'VNPAY', paymentStatus: 'SUCCESS' })} />,
      ),
    );

    expect(screen.getByText(/Đặt lúc/)).toHaveTextContent('VNPay · Đã thanh toán');
  });

  it('chưa rõ thanh toán (null) -> chỉ ngày đặt, không có dấu phân cách thừa', () => {
    render(
      withIntl(<SellerOrderCard order={order({ paymentMethod: null, paymentStatus: null })} />),
    );

    expect(screen.getByText(/Đặt lúc/).textContent).not.toContain('·');
  });

  it('đơn có hơn 3 dòng hàng: báo "và N sản phẩm khác"; đủ dòng thì không báo', () => {
    const { rerender } = render(withIntl(<SellerOrderCard order={order({ itemCount: 5 })} />));
    expect(screen.getByText('và 4 sản phẩm khác')).toBeInTheDocument();

    rerender(withIntl(<SellerOrderCard order={order({ itemCount: 1 })} />));
    expect(screen.queryByText(/sản phẩm khác/)).not.toBeInTheDocument();
  });

  it('không lộ định danh người mua: chỉ hiện thông tin người nhận trên đơn', () => {
    const leaky = { ...order(), userId: 'user-secret', buyerEmail: 'buyer@example.com' };
    const { container } = render(withIntl(<SellerOrderCard order={leaky} />));

    expect(container.textContent).not.toContain('user-secret');
    expect(container.textContent).not.toContain('buyer@example.com');
  });

  it('có actions -> hiện trong chân card cùng link chi tiết', () => {
    render(
      withIntl(
        <SellerOrderCard order={order()} actions={<button type="button">Xác nhận</button>} />,
      ),
    );

    expect(screen.getByRole('button', { name: 'Xác nhận' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Xem chi tiết' })).toBeInTheDocument();
  });

  it('đơn không còn hành động nào (actions rỗng) vẫn có link tới chi tiết để xem lại', () => {
    render(withIntl(<SellerOrderCard order={order({ status: 'COMPLETED' })} />));

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Xem chi tiết' })).toBeInTheDocument();
  });

  describe('lời nhắn của người mua (Week8.md 3B)', () => {
    it('có lời nhắn -> hiện dòng "Lời nhắn: …" ngay trên card', () => {
      render(withIntl(<SellerOrderCard order={order({ buyerNote: 'Gọi trước khi giao' })} />));

      expect(screen.getByText('Lời nhắn: Gọi trước khi giao')).toBeInTheDocument();
    });

    it('không có lời nhắn (null) -> không có dòng lời nhắn', () => {
      render(withIntl(<SellerOrderCard order={order({ buyerNote: null })} />));

      expect(screen.queryByText(/Lời nhắn/)).not.toBeInTheDocument();
    });

    it('ở danh sách chỉ cắt còn tối đa 2 dòng bằng CSS (line-clamp-2), vẫn truyền đủ nội dung', () => {
      const long = 'rất dài '.repeat(60).trim();
      render(withIntl(<SellerOrderCard order={order({ buyerNote: long })} />));

      const note = screen.getByText(`Lời nhắn: ${long}`);
      expect(note).toHaveClass('line-clamp-2', 'break-words');
    });

    it('lời nhắn có HTML hiển thị như văn bản, không chèn thẻ vào trang', () => {
      const html = '<img src=x onerror=alert(1)>';
      const { container } = render(
        withIntl(<SellerOrderCard order={order({ buyerNote: html })} />),
      );

      expect(container.querySelector('img')).toBeNull();
      expect(screen.getByText(`Lời nhắn: ${html}`)).toBeInTheDocument();
    });

    it('lời nhắn chứa dấu ngoặc nhọn/ICU không làm hỏng bản dịch', () => {
      render(withIntl(<SellerOrderCard order={order({ buyerNote: 'giá {count} {x} ' })} />));

      expect(screen.getByText('Lời nhắn: giá {count} {x}')).toBeInTheDocument();
    });
  });

  describe('yêu cầu hủy/trả hàng của người mua', () => {
    const request = (
      overrides: Partial<NonNullable<SellerOrderListItem['refundRequest']>> = {},
    ): NonNullable<SellerOrderListItem['refundRequest']> => ({
      id: 'request-1',
      kind: 'CANCEL',
      status: 'PENDING_SELLER',
      sellerRespondBy: '2026-10-03T03:00:00.000Z',
      ...overrides,
    });

    it('không có yêu cầu -> không có dòng yêu cầu và không có hạn phản hồi', () => {
      render(withIntl(<SellerOrderCard order={order({ refundRequest: null })} />));

      expect(screen.queryByText('Yêu cầu hủy đơn')).not.toBeInTheDocument();
      expect(screen.queryByText(/Hạn phản hồi/)).not.toBeInTheDocument();
    });

    it('yêu cầu hủy đang chờ shop: loại yêu cầu + huy hiệu + HẠN phản hồi ngay ở danh sách (không phải mở từng đơn mới biết)', () => {
      render(withIntl(<SellerOrderCard order={order({ refundRequest: request() })} />));

      expect(screen.getByText('Yêu cầu hủy đơn')).toBeInTheDocument();
      expect(screen.getByText('Chờ shop phản hồi')).toBeInTheDocument();
      expect(screen.getByText(/Hạn phản hồi: .*2026/)).toBeInTheDocument();
      expect(screen.getByText(/đơn sẽ tự động bị hủy/)).toBeInTheDocument();
    });

    it('yêu cầu trả hàng chờ shop: đúng loại và hệ quả quá hạn là chuyển lên sàn', () => {
      render(
        withIntl(<SellerOrderCard order={order({ refundRequest: request({ kind: 'RETURN' }) })} />),
      );

      expect(screen.getByText('Yêu cầu trả hàng/hoàn tiền')).toBeInTheDocument();
      expect(screen.getByText(/chuyển lên sàn xử lý/)).toBeInTheDocument();
    });

    it.each([
      ['ESCALATED', 'Chờ sàn xem xét'],
      ['APPROVED', 'Đã chấp thuận'],
      ['REJECTED_BY_SELLER', 'Shop đã từ chối'],
      ['REJECTED', 'Sàn đã từ chối'],
    ] as const)(
      'yêu cầu đã sang bước %s: huy hiệu "%s", KHÔNG còn hạn phản hồi',
      (status, label) => {
        render(withIntl(<SellerOrderCard order={order({ refundRequest: request({ status }) })} />));

        expect(screen.getByText(label)).toBeInTheDocument();
        expect(screen.queryByText(/Hạn phản hồi/)).not.toBeInTheDocument();
      },
    );

    it('dòng yêu cầu không làm mất các nút hành động của card', () => {
      render(
        withIntl(
          <SellerOrderCard
            order={order({ refundRequest: request() })}
            actions={<button type="button">Hủy đơn</button>}
          />,
        ),
      );

      expect(screen.getByRole('button', { name: 'Hủy đơn' })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Xem chi tiết' })).toBeInTheDocument();
    });
  });

  it('link chi tiết trỏ /seller/orders/<id đầy đủ> (không phải mã rút gọn, không phải /orders của người mua)', () => {
    render(withIntl(<SellerOrderCard order={order()} />));

    expect(screen.getByRole('link', { name: 'Xem chi tiết' })).toHaveAttribute(
      'href',
      '/seller/orders/abcdef12-3456-4789-8abc-def012345678',
    );
  });
});
