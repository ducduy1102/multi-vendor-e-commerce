import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import { AddressForm } from './AddressForm';

function renderForm(props: Partial<React.ComponentProps<typeof AddressForm>> = {}) {
  const onSubmit = vi.fn();
  render(withIntl(<AddressForm onSubmit={onSubmit} {...props} />));
  return { onSubmit };
}

async function fillValid(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Họ tên người nhận'), 'Nguyễn Văn A');
  await user.type(screen.getByLabelText('Số điện thoại'), '0912345678');
  await user.type(screen.getByLabelText('Số nhà, tên đường'), '12 Nguyễn Huệ');
  await user.type(screen.getByLabelText('Xã/Phường'), 'Phường Bến Nghé');
  await user.selectOptions(screen.getByLabelText('Tỉnh/Thành phố'), 'Hồ Chí Minh');
}

describe('AddressForm', () => {
  it('không có ô Quận/Huyện (địa chỉ 2 cấp, Week7.md 1.8)', () => {
    renderForm();

    expect(screen.queryByLabelText(/quận|huyện/i)).not.toBeInTheDocument();
  });

  it('gửi form trống -> báo lỗi theo từng ô, KHÔNG gọi onSubmit', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderForm();

    await user.click(screen.getByRole('button', { name: 'Lưu địa chỉ' }));

    expect(await screen.findByText('Vui lòng nhập tên người nhận')).toBeInTheDocument();
    expect(screen.getByText('Số điện thoại không hợp lệ')).toBeInTheDocument();
    expect(screen.getByText('Vui lòng nhập số nhà, đường')).toBeInTheDocument();
    expect(screen.getByText('Vui lòng nhập Xã/Phường')).toBeInTheDocument();
    expect(screen.getByText('Vui lòng chọn Tỉnh/Thành phố hợp lệ')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Họ tên người nhận')).toHaveAttribute('aria-invalid', 'true');
  });

  it('số điện thoại sai định dạng -> báo lỗi đúng ô, không chặn ô khác', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderForm();

    await user.type(screen.getByLabelText('Số điện thoại'), '123');
    await user.click(screen.getByRole('button', { name: 'Lưu địa chỉ' }));

    expect(await screen.findByText('Số điện thoại không hợp lệ')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('nhập hợp lệ -> onSubmit nhận đúng giá trị (chuỗi thô, chưa chuẩn hoá)', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderForm();

    await fillValid(user);
    await user.click(screen.getByRole('button', { name: 'Lưu địa chỉ' }));

    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toEqual({
      recipientName: 'Nguyễn Văn A',
      phone: '0912345678',
      line1: '12 Nguyễn Huệ',
      ward: 'Phường Bến Nghé',
      province: 'Hồ Chí Minh',
    });
  });

  it('đang gửi -> nút đổi chữ và bị vô hiệu, chặn bấm trùng', () => {
    renderForm({ isSubmitting: true });

    expect(screen.getByRole('button', { name: 'Đang lưu...' })).toBeDisabled();
  });
});
