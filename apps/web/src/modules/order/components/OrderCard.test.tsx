import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { formatPrice } from '@/modules/product';
import { withIntl } from '@/shared/lib/test-i18n';

import type { OrderListItem } from '../types';
import { OrderCard } from './OrderCard';

// formatPrice (Intl) chèn ký tự NBSP trước "₫", còn getByText chuẩn hoá mọi khoảng trắng của nội
// dung DOM thành dấu cách thường nhưng KHÔNG chuẩn hoá chuỗi tìm — nên phải chuẩn hoá phía test.
const price = (value: string) => formatPrice(value).replace(/\s/g, ' ');

function order(overrides: Partial<OrderListItem> = {}): OrderListItem {
  return {
    id: 'order-1',
    checkoutGroupId: 'group-1',
    status: 'PENDING',
    createdAt: '2026-10-01T03:30:00.000Z',
    totalAmount: '320000',
    shop: { id: 'shop-1', name: 'Shop Áo Xinh', slug: 'shop-ao-xinh', logoUrl: null },
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
    canCancel: false,
    canRequestCancel: false,
    canRequestReturn: false,
    canConfirmReceived: false,
    canRetryPayment: false,
    ...overrides,
  };
}

describe('OrderCard', () => {
  it('hiện tên shop, trạng thái, dòng hàng (tên, phân loại, đơn giá, số lượng) và tổng tiền định dạng VND', () => {
    render(withIntl(<OrderCard order={order()} />));

    expect(screen.getByRole('heading', { name: 'Shop Áo Xinh' })).toBeInTheDocument();
    expect(screen.getByText('Chờ xác nhận')).toBeInTheDocument();
    expect(screen.getByText('Áo thun nam')).toBeInTheDocument();
    expect(screen.getByText('Đỏ / M')).toBeInTheDocument();
    expect(screen.getByText(price('150000'))).toBeInTheDocument();
    expect(screen.getByText('×2')).toBeInTheDocument();
    expect(screen.getByText(price('320000'))).toBeInTheDocument();
    expect(screen.getByText(/Tổng tiền/)).toBeInTheDocument();
  });

  it('có phương thức thanh toán thì hiện nhãn đã dịch (COD = Thanh toán khi nhận hàng) cùng ngày đặt', () => {
    render(withIntl(<OrderCard order={order({ paymentMethod: 'COD' })} />));

    const summary = screen.getByText(/Đặt lúc/);
    expect(summary).toHaveTextContent('Thanh toán khi nhận hàng');
    expect(summary).toHaveTextContent('2026');
  });

  it('chưa có phương thức thanh toán (null) -> chỉ hiện ngày đặt, không có dấu phân cách thừa', () => {
    render(withIntl(<OrderCard order={order({ paymentMethod: null })} />));

    const summary = screen.getByText(/Đặt lúc/);
    expect(summary.textContent).not.toContain('·');
  });

  it('dòng hàng không có phân loại (variantLabel null) -> không hiện dòng phân loại rỗng', () => {
    render(
      withIntl(
        <OrderCard
          order={order({
            items: [
              {
                productName: 'Sách',
                variantLabel: null,
                sku: 'S-1',
                imageUrl: null,
                quantity: 1,
                priceAtPurchase: '50000',
              },
            ],
          })}
        />,
      ),
    );

    expect(screen.getByText('Sách')).toBeInTheDocument();
    expect(screen.queryByText('null')).not.toBeInTheDocument();
  });

  it('itemCount lớn hơn số dòng xem nhanh -> báo "và N sản phẩm khác"', () => {
    render(withIntl(<OrderCard order={order({ itemCount: 5 })} />));

    expect(screen.getByText('và 4 sản phẩm khác')).toBeInTheDocument();
  });

  it('đủ mọi dòng hàng (itemCount bằng số dòng hiện) -> không hiện dòng "sản phẩm khác"', () => {
    render(withIntl(<OrderCard order={order({ itemCount: 1 })} />));

    expect(screen.queryByText(/sản phẩm khác/)).not.toBeInTheDocument();
  });

  it('thiếu ảnh -> hiện biểu tượng thay thế (ẩn với trình đọc màn hình), không có thẻ img', () => {
    const { container } = render(withIntl(<OrderCard order={order()} />));

    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
  });

  it('luôn có link "Xem chi tiết" tới /orders/<id>', () => {
    render(withIntl(<OrderCard order={order({ id: 'order-42' })} />));

    expect(screen.getByRole('link', { name: 'Xem chi tiết' })).toHaveAttribute(
      'href',
      '/orders/order-42',
    );
  });

  it('chèn nút hành động do Container truyền vào (card không tự biết hành động nào)', () => {
    render(
      withIntl(
        <OrderCard order={order()} actions={<button type="button">Hành động thử</button>} />,
      ),
    );

    const card = screen.getByRole('article');
    expect(within(card).getByRole('button', { name: 'Hành động thử' })).toBeInTheDocument();
  });

  it('tên shop dài bị cắt (truncate) chứ không đẩy badge trạng thái ra ngoài khung', () => {
    render(
      withIntl(
        <OrderCard
          order={order({ shop: { id: 's', name: 'A'.repeat(200), slug: 'a', logoUrl: null } })}
        />,
      ),
    );

    expect(screen.getByRole('heading')).toHaveClass('truncate', 'min-w-0');
    expect(screen.getByText('Chờ xác nhận')).toHaveClass('shrink-0');
  });
});
