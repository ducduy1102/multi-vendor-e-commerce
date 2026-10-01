import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import type { CheckoutPreview } from '../types';
import { CheckoutSummary } from './CheckoutSummary';

function preview(overrides: Partial<CheckoutPreview> = {}): CheckoutPreview {
  return {
    orders: [],
    subtotal: '300000',
    shippingTotal: '16500',
    discountTotal: '0',
    grandTotal: '316500',
    discount: null,
    needsAddress: false,
    paymentMethods: [{ method: 'VNPAY', available: true }],
    excludedItems: [],
    blockingIssues: [],
    canPlaceOrder: true,
    ...overrides,
  };
}

function renderSummary(overrides: Partial<React.ComponentProps<typeof CheckoutSummary>> = {}) {
  const onSubmit = vi.fn();
  const onSelectPaymentMethod = vi.fn();
  render(
    withIntl(
      <CheckoutSummary
        preview={preview()}
        paymentMethod="VNPAY"
        onSelectPaymentMethod={onSelectPaymentMethod}
        onSubmit={onSubmit}
        isSubmitting={false}
        canSubmit={true}
        submitError={null}
        outOfStockItems={[]}
        pendingGroupIds={[]}
        {...overrides}
      />,
    ),
  );
  return { onSubmit, onSelectPaymentMethod };
}

describe('CheckoutSummary', () => {
  it('hiện tổng tiền hàng/phí ship/tổng thanh toán, KHÔNG hiện dòng giảm giá khi discountTotal = 0', () => {
    renderSummary();

    expect(screen.getByText('300.000 ₫')).toBeInTheDocument();
    expect(screen.getByText('16.500 ₫')).toBeInTheDocument();
    expect(screen.getByText('316.500 ₫')).toBeInTheDocument();
    expect(screen.queryByText('Tổng giảm giá')).not.toBeInTheDocument();
  });

  it('discountTotal > 0 -> hiện dòng tổng giảm giá', () => {
    renderSummary({ preview: preview({ discountTotal: '20000' }) });

    expect(screen.getByText('Tổng giảm giá')).toBeInTheDocument();
    expect(screen.getByText('-20.000 ₫')).toBeInTheDocument();
  });

  it('needsAddress -> hiện thông báo cần chọn địa chỉ, giá trị null hiện gạch ngang', () => {
    renderSummary({
      preview: preview({ needsAddress: true, shippingTotal: null, grandTotal: null }),
    });

    expect(
      screen.getByText('Chọn địa chỉ giao hàng để tính phí vận chuyển và tổng tiền'),
    ).toBeInTheDocument();
    expect(screen.getAllByText('—')).toHaveLength(2);
  });

  it('excludedItems -> hiện danh sách sản phẩm không thể thanh toán', () => {
    renderSummary({
      preview: preview({
        excludedItems: [{ cartItemId: 'item-1', name: 'Áo thun', reason: 'UNAVAILABLE' }],
      }),
    });

    expect(screen.getByText('Sản phẩm không thể thanh toán')).toBeInTheDocument();
    expect(screen.getByText(/Áo thun/)).toBeInTheDocument();
  });

  it('blockingIssues -> hiện cảnh báo vượt tồn kho kèm link quay lại giỏ hàng', () => {
    renderSummary({
      preview: preview({
        blockingIssues: [{ cartItemId: 'item-1', type: 'INSUFFICIENT_STOCK', available: 1 }],
      }),
    });

    expect(screen.getByText('Một số sản phẩm vượt quá tồn kho')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Quay lại giỏ hàng' })).toHaveAttribute(
      'href',
      '/cart',
    );
  });

  it('outOfStockItems (lỗi lúc đặt hàng) -> hiện danh sách hết hàng', () => {
    renderSummary({
      outOfStockItems: [
        { productVariantId: 'v1', productName: 'Áo thun', variantLabel: 'M / Đen', available: 1 },
      ],
    });

    expect(screen.getByText('Sản phẩm đã hết hàng')).toBeInTheDocument();
    expect(screen.getByText(/Áo thun \(M \/ Đen\)/)).toBeInTheDocument();
  });

  it('pendingGroupIds -> hiện link tới từng nhóm đang chờ thanh toán', () => {
    renderSummary({ pendingGroupIds: ['group-1', 'group-2'] });

    expect(screen.getByText('Bạn có đơn đang chờ thanh toán')).toBeInTheDocument();
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveTextContent('Xem đơn #1');
  });

  it('submitError -> hiện thông báo lỗi', () => {
    renderSummary({ submitError: 'Đặt hàng thất bại' });

    expect(screen.getByText('Đặt hàng thất bại')).toBeInTheDocument();
  });

  it('canSubmit=false -> nút Đặt hàng bị disabled', () => {
    renderSummary({ canSubmit: false });

    expect(screen.getByRole('button', { name: 'Đặt hàng' })).toBeDisabled();
  });

  it('isSubmitting -> đổi chữ nút và disabled', () => {
    renderSummary({ isSubmitting: true });

    expect(screen.getByRole('button', { name: 'Đang xử lý...' })).toBeDisabled();
  });

  it('bấm nút Đặt hàng -> gọi onSubmit', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderSummary();

    await user.click(screen.getByRole('button', { name: 'Đặt hàng' }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});
