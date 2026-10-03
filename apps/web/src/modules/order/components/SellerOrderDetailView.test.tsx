import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { formatPrice } from '@/modules/product';
import { withIntl } from '@/shared/lib/test-i18n';

import type { SellerOrderDetail } from '../types';
import { SellerOrderDetailView } from './SellerOrderDetailView';

// formatPrice (Intl) chèn NBSP trước "₫" còn getByText chỉ chuẩn hoá phía DOM — chuẩn hoá phía test.
const price = (value: string) => formatPrice(value).replace(/\s/g, ' ');

const ITEM = (n: number) => ({
  productName: `Sản phẩm ${n}`,
  variantLabel: 'Đỏ / M',
  sku: `SKU-${n}`,
  imageUrl: null,
  quantity: 2,
  priceAtPurchase: '150000',
});

function order(overrides: Partial<SellerOrderDetail> = {}): SellerOrderDetail {
  return {
    id: 'abcdef12-3456-4789-8abc-def012345678',
    status: 'PENDING',
    createdAt: '2026-10-01T03:30:00.000Z',
    totalAmount: '320000',
    recipientName: 'Nguyễn Văn A',
    shippingProvince: 'TP. Hồ Chí Minh',
    items: [ITEM(1), ITEM(2), ITEM(3), ITEM(4), ITEM(5)],
    itemCount: 5,
    paymentMethod: 'COD',
    paymentStatus: 'PENDING',
    canConfirm: true,
    canPack: false,
    canShip: false,
    canReject: true,
    recipientPhone: '0901234567',
    shippingAddressLine: '1 Lê Lợi',
    shippingWard: 'Bến Nghé',
    subtotal: '300000',
    discountAmount: '0',
    shippingFee: '20000',
    carrier: null,
    trackingCode: null,
    history: [
      {
        fromStatus: null,
        toStatus: 'PENDING',
        actorType: 'BUYER',
        note: null,
        createdAt: '2026-10-01T03:30:00.000Z',
      },
    ],
    ...overrides,
  };
}

describe('SellerOrderDetailView', () => {
  it('đầu trang: tên người nhận, trạng thái, mã đơn ĐẦY ĐỦ và ngày đặt', () => {
    render(withIntl(<SellerOrderDetailView order={order()} />));

    expect(screen.getByRole('heading', { name: 'Nguyễn Văn A' })).toBeInTheDocument();
    expect(screen.getByText('Chờ xác nhận')).toBeInTheDocument();
    expect(screen.getByText('Mã đơn: abcdef12-3456-4789-8abc-def012345678')).toBeInTheDocument();
    expect(screen.getByText(/Đặt lúc/)).toHaveTextContent('2026');
  });

  it('liệt kê ĐỦ mọi dòng hàng (không bị cắt còn 3 như ở danh sách)', () => {
    render(withIntl(<SellerOrderDetailView order={order()} />));

    const items = within(screen.getByRole('region', { name: 'Sản phẩm' }));
    expect(items.getAllByRole('listitem')).toHaveLength(5);
    expect(items.getByText('Sản phẩm 5')).toBeInTheDocument();
  });

  it('người nhận: tên, SĐT và địa chỉ đủ 3 cấp (Seller cần để đóng gói và giao)', () => {
    render(withIntl(<SellerOrderDetailView order={order()} />));

    const address = within(screen.getByRole('region', { name: 'Địa chỉ nhận hàng' }));
    expect(address.getByText('Nguyễn Văn A')).toBeInTheDocument();
    expect(address.getByText('0901234567')).toBeInTheDocument();
    expect(address.getByText('1 Lê Lợi, Bến Nghé, TP. Hồ Chí Minh')).toBeInTheDocument();
  });

  it('đơn COD chưa thu tiền: "Thanh toán khi nhận hàng" + "Chưa thanh toán" để biết còn phải thu', () => {
    render(withIntl(<SellerOrderDetailView order={order()} />));

    const payment = within(screen.getByRole('region', { name: 'Thanh toán' }));
    expect(payment.getByText('Thanh toán khi nhận hàng')).toBeInTheDocument();
    expect(payment.getByText('Chưa thanh toán')).toBeInTheDocument();
  });

  it('đơn đã trả online: "VNPay" + "Đã thanh toán"', () => {
    render(
      withIntl(
        <SellerOrderDetailView
          order={order({ paymentMethod: 'VNPAY', paymentStatus: 'SUCCESS' })}
        />,
      ),
    );

    const payment = within(screen.getByRole('region', { name: 'Thanh toán' }));
    expect(payment.getByText('VNPay')).toBeInTheDocument();
    expect(payment.getByText('Đã thanh toán')).toBeInTheDocument();
  });

  it('tiền lấy nguyên từ BE, không tự cộng lại: tổng cộng hiện totalAmount dù khác subtotal + ship', () => {
    render(withIntl(<SellerOrderDetailView order={order({ totalAmount: '999000' })} />));

    const payment = within(screen.getByRole('region', { name: 'Thanh toán' }));
    expect(payment.getByText(price('300000'))).toBeInTheDocument();
    expect(payment.getByText(price('20000'))).toBeInTheDocument();
    expect(payment.getByText(price('999000'))).toBeInTheDocument();
  });

  it('có giảm giá -> hiện dòng "Giảm giá" với dấu trừ; không giảm -> không có dòng đó', () => {
    const { rerender } = render(
      withIntl(<SellerOrderDetailView order={order({ discountAmount: '30000' })} />),
    );
    expect(screen.getByText(`-${price('30000')}`)).toBeInTheDocument();

    rerender(withIntl(<SellerOrderDetailView order={order({ discountAmount: '0' })} />));
    expect(screen.queryByText('Giảm giá')).not.toBeInTheDocument();
  });

  it('chưa có vận chuyển -> không có mục "Vận chuyển"; có thì hiện đơn vị và mã vận đơn', () => {
    const { rerender } = render(withIntl(<SellerOrderDetailView order={order()} />));
    expect(screen.queryByRole('region', { name: 'Vận chuyển' })).not.toBeInTheDocument();

    rerender(
      withIntl(
        <SellerOrderDetailView
          order={order({ status: 'SHIPPING', carrier: 'Giao Hàng Nhanh', trackingCode: 'GHN123' })}
        />,
      ),
    );
    const shipping = within(screen.getByRole('region', { name: 'Vận chuyển' }));
    expect(shipping.getByText('Giao Hàng Nhanh')).toBeInTheDocument();
    expect(shipping.getByText('GHN123')).toBeInTheDocument();
  });

  it('lịch sử viết theo góc nhìn shop: người mua hủy -> "Người mua đã hủy đơn hàng" (không phải "Bạn đã hủy")', () => {
    render(
      withIntl(
        <SellerOrderDetailView
          order={order({
            status: 'CANCELLED',
            history: [
              {
                fromStatus: null,
                toStatus: 'PENDING',
                actorType: 'BUYER',
                note: null,
                createdAt: '2026-10-01T03:30:00.000Z',
              },
              {
                fromStatus: 'PENDING',
                toStatus: 'CANCELLED',
                actorType: 'BUYER',
                note: 'Cancelled by buyer',
                createdAt: '2026-10-01T04:00:00.000Z',
              },
            ],
          })}
        />,
      ),
    );

    const timeline = within(screen.getByRole('region', { name: 'Lịch sử đơn hàng' }));
    expect(timeline.getByText('Người mua đã hủy đơn hàng')).toBeInTheDocument();
    expect(timeline.queryByText('Bạn đã hủy đơn hàng')).not.toBeInTheDocument();
    expect(timeline.queryByText(/Cancelled by buyer/)).not.toBeInTheDocument();
  });

  it('chính shop từ chối kèm lý do -> hiện lại lý do shop đã nhập', () => {
    render(
      withIntl(
        <SellerOrderDetailView
          order={order({
            status: 'CANCELLED',
            history: [
              {
                fromStatus: 'PENDING',
                toStatus: 'CANCELLED',
                actorType: 'SELLER',
                note: 'Hết hàng',
                createdAt: '2026-10-01T04:00:00.000Z',
              },
            ],
          })}
        />,
      ),
    );

    expect(screen.getByText('Lý do của shop: Hết hàng')).toBeInTheDocument();
  });

  it('không lộ định danh người mua (chỉ thông tin người nhận trên đơn)', () => {
    const leaky = { ...order(), userId: 'user-secret', buyerEmail: 'buyer@example.com' };
    const { container } = render(withIntl(<SellerOrderDetailView order={leaky} />));

    expect(container.textContent).not.toContain('user-secret');
    expect(container.textContent).not.toContain('buyer@example.com');
  });

  it('có actions -> hiện ở đầu trang; không có -> ẩn cả dải hành động (empty:hidden)', () => {
    const { container, rerender } = render(
      withIntl(
        <SellerOrderDetailView order={order()} actions={<button type="button">Xác nhận</button>} />,
      ),
    );
    expect(screen.getByRole('button', { name: 'Xác nhận' })).toBeInTheDocument();

    rerender(withIntl(<SellerOrderDetailView order={order()} />));
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    const footer = container.querySelector('section > div.empty\\:hidden');
    expect(footer).not.toBeNull();
    expect(footer).toBeEmptyDOMElement();
  });
});
