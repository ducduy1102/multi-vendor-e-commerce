import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import type { CheckoutGroup } from '../types';
import { CheckoutResultView } from './CheckoutResultView';

function group(overrides: Partial<CheckoutGroup> = {}): CheckoutGroup {
  return {
    id: 'group-1',
    status: 'AWAITING_PAYMENT',
    canRetry: true,
    expiresAt: '2026-09-27T04:15:00.000Z',
    createdAt: '2026-09-27T04:00:00.000Z',
    totalAmount: '320000',
    paymentMethod: 'VNPAY',
    latestPaymentStatus: 'PENDING',
    orders: [
      {
        id: 'order-1',
        shopId: 'shop-1',
        shopName: 'Shop Áo Xinh',
        status: 'AWAITING_PAYMENT',
        subtotal: '300000',
        discountAmount: '0',
        shippingFee: '20000',
        totalAmount: '320000',
        items: [],
      },
    ],
    ...overrides,
  };
}

interface Props {
  group?: CheckoutGroup;
  isReloading?: boolean;
  isRetryingPayment?: boolean;
  retryPaymentError?: string | null;
}

function renderView({
  group: groupProp = group(),
  isReloading = false,
  isRetryingPayment = false,
  retryPaymentError = null,
}: Props = {}) {
  const onReload = vi.fn();
  const onRetryPayment = vi.fn();
  const utils = render(
    withIntl(
      <CheckoutResultView
        group={groupProp}
        onReload={onReload}
        isReloading={isReloading}
        onRetryPayment={onRetryPayment}
        isRetryingPayment={isRetryingPayment}
        retryPaymentError={retryPaymentError}
      />,
    ),
  );
  return { onReload, onRetryPayment, ...utils };
}

describe('CheckoutResultView', () => {
  it('AWAITING_PAYMENT (kể cả khi latestPaymentStatus=PENDING) -> luôn hiện "đang xác nhận", KHÔNG hiện thành công (1.10: component không đọc/tin tham số cổng thanh toán, chỉ dựa vào group.status)', () => {
    renderView({ group: group({ status: 'AWAITING_PAYMENT', latestPaymentStatus: 'PENDING' }) });

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Đang xác nhận thanh toán. Nếu bạn vừa thanh toán xong, vui lòng đợi trong giây lát.',
    );
    expect(screen.queryByText(/thanh toán thành công/i)).not.toBeInTheDocument();
  });

  it('AWAITING_PAYMENT -> hiện cả nút "Thử lại" (tải lại) và "Tiếp tục thanh toán"', async () => {
    const user = userEvent.setup();
    const { onReload, onRetryPayment } = renderView({
      group: group({ status: 'AWAITING_PAYMENT', canRetry: true }),
    });

    await user.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(onReload).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Tiếp tục thanh toán' }));
    expect(onRetryPayment).toHaveBeenCalledTimes(1);
  });

  it('PAID -> hiện thông báo thành công, KHÔNG có nút tải lại/thanh toán lại', () => {
    renderView({ group: group({ status: 'PAID', canRetry: false }) });

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Đặt hàng và thanh toán thành công! Cảm ơn bạn đã mua sắm.',
    );
    expect(screen.queryByRole('button', { name: 'Thử lại' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Tiếp tục thanh toán' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Thanh toán lại' })).not.toBeInTheDocument();
  });

  it('PAYMENT_FAILED -> hiện đúng nút "Thanh toán lại", KHÔNG có nút tải lại', async () => {
    const user = userEvent.setup();
    const { onRetryPayment } = renderView({
      group: group({ status: 'PAYMENT_FAILED', canRetry: true }),
    });

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Thanh toán không thành công. Bạn có thể thử thanh toán lại trước khi đơn hết hạn giữ chỗ.',
    );
    expect(screen.queryByRole('button', { name: 'Thử lại' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Thanh toán lại' }));
    expect(onRetryPayment).toHaveBeenCalledTimes(1);
  });

  it('PAYMENT_EXPIRED -> thông báo hết hạn, không còn nút thanh toán nào', () => {
    renderView({ group: group({ status: 'PAYMENT_EXPIRED', canRetry: false }) });

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Đơn hàng chưa được thanh toán kịp thời nên đã hết hạn và bị huỷ. Vui lòng đặt lại đơn hàng.',
    );
    expect(screen.queryByRole('button', { name: 'Thử lại' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Thanh toán lại' })).not.toBeInTheDocument();
  });

  it('CANCELLED -> thông báo đã huỷ', () => {
    renderView({ group: group({ status: 'CANCELLED', canRetry: false }) });

    expect(screen.getByRole('alert')).toHaveTextContent('Đơn hàng đã bị huỷ.');
  });

  it('PAID_AFTER_EXPIRY -> thông báo đã ghi nhận tiền nhưng đơn đã huỷ, KHÔNG hiện là thành công', () => {
    renderView({ group: group({ status: 'PAID_AFTER_EXPIRY', canRetry: false }) });

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('sẽ được hoàn lại');
    expect(alert).not.toHaveTextContent('Đặt hàng và thanh toán thành công');
  });

  it('COD_PLACED -> báo thanh toán khi nhận hàng, KHÔNG nói đã thanh toán, không có nút thanh toán/thử lại, hiện nhãn COD', () => {
    renderView({
      group: group({
        status: 'COD_PLACED',
        canRetry: false,
        paymentMethod: 'COD',
        expiresAt: null,
        latestPaymentStatus: 'PENDING',
      }),
    });

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('thanh toán khi nhận hàng');
    expect(alert).not.toHaveTextContent('thanh toán thành công');
    expect(screen.getByText('Thanh toán khi nhận hàng (COD)')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Thanh toán lại' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Tiếp tục thanh toán' })).not.toBeInTheDocument();
  });

  it('lỗi thanh toán lại (retryPaymentError) -> hiện thành alert riêng', () => {
    renderView({ retryPaymentError: 'Không thể thanh toán lại cho đơn này lúc này' });

    expect(screen.getByText('Không thể thanh toán lại cho đơn này lúc này')).toBeInTheDocument();
  });

  it('đang gửi retryPayment -> nút hiện "Đang xử lý..." và disabled', () => {
    renderView({ isRetryingPayment: true });

    const button = screen.getByRole('button', { name: 'Đang xử lý...' });
    expect(button).toBeDisabled();
  });

  it('paymentMethod null -> không hiện dòng phương thức thanh toán', () => {
    renderView({ group: group({ paymentMethod: null }) });

    expect(screen.queryByText('VNPay')).not.toBeInTheDocument();
  });

  it('hiện danh sách đơn theo shop kèm tổng tiền', () => {
    renderView({
      group: group({
        orders: [
          {
            id: 'order-1',
            shopId: 'shop-1',
            shopName: 'Shop Áo Xinh',
            status: 'AWAITING_PAYMENT',
            subtotal: '300000',
            discountAmount: '0',
            shippingFee: '20000',
            totalAmount: '320000',
            items: [],
          },
          {
            id: 'order-2',
            shopId: 'shop-2',
            shopName: 'Shop Giày Đẹp',
            status: 'AWAITING_PAYMENT',
            subtotal: '150000',
            discountAmount: '0',
            shippingFee: '15000',
            totalAmount: '165000',
            items: [],
          },
        ],
      }),
    });

    const ordersList = screen.getByRole('heading', { name: 'Đơn hàng của bạn' })
      .parentElement as HTMLElement;
    expect(within(ordersList).getByText('Shop Áo Xinh').nextSibling).toHaveTextContent('320.000 ₫');
    expect(within(ordersList).getByText('Shop Giày Đẹp').nextSibling).toHaveTextContent(
      '165.000 ₫',
    );
  });

  it('luôn có link quay lại mua sắm (Button render={<Link/>} nativeButton=false -> role="button", href vẫn ở thẻ <a>)', () => {
    renderView();

    expect(screen.getByRole('button', { name: 'Khám phá sản phẩm' })).toHaveAttribute(
      'href',
      '/products',
    );
  });
});
