import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import { VoucherForm } from './VoucherForm';

function renderForm(props: Partial<React.ComponentProps<typeof VoucherForm>> = {}) {
  const onSubmit = vi.fn();
  render(withIntl(<VoucherForm onSubmit={onSubmit} {...props} />));
  return { onSubmit };
}

describe('VoucherForm', () => {
  it('mặc định là giảm theo phần trăm: có ô "giảm tối đa"', () => {
    renderForm();

    expect(screen.getByLabelText('Phần trăm giảm (%)')).toBeInTheDocument();
    expect(screen.getByLabelText('Giảm tối đa (₫, tuỳ chọn)')).toBeInTheDocument();
  });

  it('đổi sang số tiền cố định -> ô "giảm tối đa" biến mất, nhãn giá trị đổi theo', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.selectOptions(screen.getByLabelText('Loại giảm giá'), 'FIXED');

    expect(screen.getByLabelText('Số tiền giảm (₫)')).toBeInTheDocument();
    expect(screen.queryByLabelText('Giảm tối đa (₫, tuỳ chọn)')).not.toBeInTheDocument();
  });

  it('gửi form trống -> báo lỗi theo từng ô, KHÔNG gọi onSubmit', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderForm();

    await user.click(screen.getByRole('button', { name: 'Tạo voucher' }));

    expect(
      await screen.findByText('Mã chỉ gồm chữ, số, gạch ngang/gạch dưới, dài 3-32 ký tự'),
    ).toBeInTheDocument();
    expect(screen.getByText('Vui lòng nhập giá trị giảm')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Mã voucher')).toHaveAttribute('aria-invalid', 'true');
  });

  it('PERCENT vượt 100 -> lỗi tại ô giá trị (tái dùng luật của BE)', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderForm();

    await user.type(screen.getByLabelText('Mã voucher'), 'SALE10');
    await user.type(screen.getByLabelText('Phần trăm giảm (%)'), '150');
    await user.click(screen.getByRole('button', { name: 'Tạo voucher' }));

    expect(await screen.findByText('Phần trăm giảm tối đa là 100')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('nhập hợp lệ -> onSubmit nhận đúng giá trị (chuỗi, để trống ô tuỳ chọn)', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderForm();

    await user.type(screen.getByLabelText('Mã voucher'), 'summer10');
    await user.type(screen.getByLabelText('Phần trăm giảm (%)'), '10');
    await user.type(screen.getByLabelText('Đơn tối thiểu (₫, tuỳ chọn)'), '200000');
    await user.click(screen.getByRole('button', { name: 'Tạo voucher' }));

    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toEqual({
      code: 'summer10',
      type: 'PERCENT',
      value: '10',
      minOrderAmount: '200000',
      maxDiscountAmount: '',
      usageLimit: '',
      perUserLimit: '',
      expiresAt: '',
    });
  });

  it('đang gửi -> nút đổi chữ và bị vô hiệu, chặn bấm trùng', () => {
    renderForm({ isSubmitting: true });

    expect(screen.getByRole('button', { name: 'Đang tạo...' })).toBeDisabled();
  });
});
