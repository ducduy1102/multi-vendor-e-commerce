import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import type { CartView } from '../types';
import { CartSummary } from './CartSummary';

function cartView(overrides: Partial<CartView> = {}): CartView {
  return {
    shops: [
      {
        shopId: 'shop-a',
        shopName: 'Shop A',
        shopSlug: 'shop-a',
        items: [],
        subtotal: '500000',
      },
    ],
    subtotal: '500000',
    discount: null,
    grandTotal: '500000',
    itemCount: 1,
    ...overrides,
  };
}

interface Props {
  cart?: CartView;
  appliedCode?: string;
  voucherError?: string | null;
  isApplying?: boolean;
}

function renderSummary({
  cart = cartView(),
  appliedCode = '',
  voucherError = null,
  isApplying = false,
}: Props = {}) {
  const onApplyVoucher = vi.fn();
  const onClearVoucher = vi.fn();
  const view = (
    <CartSummary
      cart={cart}
      appliedCode={appliedCode}
      voucherError={voucherError}
      isApplying={isApplying}
      onApplyVoucher={onApplyVoucher}
      onClearVoucher={onClearVoucher}
    />
  );
  const utils = render(withIntl(view));
  return { onApplyVoucher, onClearVoucher, ...utils };
}

describe('CartSummary', () => {
  describe('ô mã giảm giá', () => {
    it('gõ mã rồi bấm Áp dụng -> gọi onApplyVoucher với mã đã cắt khoảng trắng', async () => {
      const user = userEvent.setup();
      const { onApplyVoucher } = renderSummary();

      await user.type(screen.getByLabelText('Mã giảm giá'), '  SALE10  ');
      await user.click(screen.getByRole('button', { name: 'Áp dụng' }));

      expect(onApplyVoucher).toHaveBeenCalledTimes(1);
      expect(onApplyVoucher).toHaveBeenCalledWith('SALE10');
    });

    it('nhấn Enter trong ô nhập cũng áp mã (form submit)', async () => {
      const user = userEvent.setup();
      const { onApplyVoucher } = renderSummary();

      await user.type(screen.getByLabelText('Mã giảm giá'), 'SALE10{Enter}');

      expect(onApplyVoucher).toHaveBeenCalledWith('SALE10');
    });

    it('ô trống hoặc chỉ khoảng trắng -> nút disabled, Enter không gọi gì', async () => {
      const user = userEvent.setup();
      const { onApplyVoucher } = renderSummary();
      const button = screen.getByRole('button', { name: 'Áp dụng' });
      expect(button).toBeDisabled();

      await user.type(screen.getByLabelText('Mã giảm giá'), '   {Enter}');

      expect(button).toBeDisabled();
      expect(onApplyVoucher).not.toHaveBeenCalled();
    });

    it('đang áp mã (isApplying) -> khoá nút chặn bấm trùng', async () => {
      const user = userEvent.setup();
      renderSummary({ isApplying: true });

      await user.type(screen.getByLabelText('Mã giảm giá'), 'SALE10');

      expect(screen.getByRole('button', { name: 'Áp dụng' })).toBeDisabled();
    });

    it('giới hạn 32 ký tự và tắt gợi ý tự điền', () => {
      renderSummary();

      const input = screen.getByLabelText('Mã giảm giá');
      expect(input).toHaveAttribute('maxlength', '32');
      expect(input).toHaveAttribute('autocomplete', 'off');
    });

    it('mã đã áp lúc mở lại vẫn hiện trong ô nhập', () => {
      renderSummary({ appliedCode: 'SALE10' });

      expect(screen.getByLabelText('Mã giảm giá')).toHaveValue('SALE10');
    });
  });

  describe('lỗi mã', () => {
    it('BE từ chối -> hiện bản dịch, ô nhập aria-invalid và nối aria-describedby với lỗi', () => {
      renderSummary({ appliedCode: 'OLD', voucherError: 'Voucher has expired' });

      const alert = screen.getByRole('alert');
      expect(alert).toHaveTextContent('Mã giảm giá đã hết hạn');
      const input = screen.getByLabelText('Mã giảm giá');
      expect(input).toHaveAttribute('aria-invalid', 'true');
      expect(input).toHaveAttribute('aria-describedby', alert.id);
    });

    it('mức tối thiểu được định dạng tiền qua formatPrice', () => {
      renderSummary({
        appliedCode: 'BIG',
        voucherError: 'Order amount is below the voucher minimum (1500000)',
      });

      expect(screen.getByRole('alert')).toHaveTextContent(
        'Đơn hàng chưa đạt mức tối thiểu 1.500.000 ₫ để dùng mã này',
      );
    });

    it('không có mã đang áp -> không hiện lỗi dù voucherError còn giá trị cũ', () => {
      renderSummary({ appliedCode: '', voucherError: 'Voucher has expired' });

      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(screen.getByLabelText('Mã giảm giá')).not.toHaveAttribute('aria-invalid');
    });

    it('có lỗi thì KHÔNG hiện chip "đã áp dụng" dù cart còn discount cũ', () => {
      renderSummary({
        cart: cartView({ discount: { code: 'OLD', shopId: null, amount: '1000' } }),
        appliedCode: 'OLD',
        voucherError: 'Voucher has expired',
      });

      expect(screen.queryByText('Đã áp dụng mã OLD')).not.toBeInTheDocument();
    });
  });

  describe('mã đã áp', () => {
    it('voucher toàn sàn -> "Đã áp dụng mã X"', () => {
      renderSummary({
        cart: cartView({ discount: { code: 'SALE10', shopId: null, amount: '50000' } }),
        appliedCode: 'SALE10',
      });

      expect(screen.getByText('Đã áp dụng mã SALE10')).toBeInTheDocument();
    });

    it('voucher của shop -> nêu tên shop; shop không còn trong giỏ thì rơi về chữ chung', () => {
      const { rerender } = renderSummary({
        cart: cartView({ discount: { code: 'SHOPA', shopId: 'shop-a', amount: '50000' } }),
        appliedCode: 'SHOPA',
      });
      expect(screen.getByText('Đã áp dụng mã SHOPA cho Shop A')).toBeInTheDocument();

      rerender(
        withIntl(
          <CartSummary
            cart={cartView({ discount: { code: 'SHOPA', shopId: 'gone', amount: '50000' } })}
            appliedCode="SHOPA"
            voucherError={null}
            isApplying={false}
            onApplyVoucher={vi.fn()}
            onClearVoucher={vi.fn()}
          />,
        ),
      );
      expect(screen.getByText('Đã áp dụng mã SHOPA')).toBeInTheDocument();
    });

    it('bấm Bỏ mã -> xoá ô nhập và gọi onClearVoucher', async () => {
      const user = userEvent.setup();
      const { onClearVoucher } = renderSummary({
        cart: cartView({ discount: { code: 'SALE10', shopId: null, amount: '50000' } }),
        appliedCode: 'SALE10',
      });

      await user.click(screen.getByRole('button', { name: 'Bỏ mã' }));

      expect(onClearVoucher).toHaveBeenCalledTimes(1);
      expect(screen.getByLabelText('Mã giảm giá')).toHaveValue('');
    });
  });

  describe('số tiền', () => {
    it('chưa có mã -> chỉ tạm tính và tổng cộng, KHÔNG có dòng giảm giá', () => {
      renderSummary();

      const summary = screen.getByRole('complementary', { name: 'Tóm tắt đơn hàng' });
      expect(within(summary).queryByText('Giảm giá')).not.toBeInTheDocument();
      expect(within(summary).getByText('Tạm tính').nextSibling).toHaveTextContent('500.000 ₫');
      expect(within(summary).getByText('Tổng cộng').nextSibling).toHaveTextContent('500.000 ₫');
    });

    it('có mã -> dòng giảm giá hiện dấu trừ, tổng cộng là số sau giảm (lấy từ BE, không tự tính)', () => {
      renderSummary({
        cart: cartView({
          discount: { code: 'SALE10', shopId: null, amount: '50000' },
          grandTotal: '450000',
        }),
        appliedCode: 'SALE10',
      });

      const summary = screen.getByRole('complementary', { name: 'Tóm tắt đơn hàng' });
      expect(within(summary).getByText('Giảm giá').nextSibling).toHaveTextContent('-50.000 ₫');
      expect(within(summary).getByText('Tổng cộng').nextSibling).toHaveTextContent('450.000 ₫');
    });
  });

  it('nút thanh toán luôn disabled kèm ghi chú (checkout thuộc Tuần 7)', () => {
    renderSummary();

    const button = screen.getByRole('button', { name: 'Tiến hành thanh toán' });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription('Tính năng thanh toán sắp ra mắt');
  });
});
