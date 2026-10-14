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

  describe('chế độ sửa (initialValues, Week9.md 6.2)', () => {
    const existing = {
      recipientName: 'Trần Thị B',
      phone: '0987654321',
      line1: '5 Lê Lợi',
      ward: 'Phường 1',
      province: 'Hà Nội',
    };

    it('điền sẵn mọi ô và đổi nhãn nút thành "Lưu thay đổi"', () => {
      renderForm({ initialValues: existing });

      expect(screen.getByLabelText('Họ tên người nhận')).toHaveValue('Trần Thị B');
      expect(screen.getByLabelText('Số điện thoại')).toHaveValue('0987654321');
      expect(screen.getByLabelText('Số nhà, tên đường')).toHaveValue('5 Lê Lợi');
      expect(screen.getByLabelText('Xã/Phường')).toHaveValue('Phường 1');
      expect(screen.getByLabelText('Tỉnh/Thành phố')).toHaveValue('Hà Nội');
      expect(screen.getByRole('button', { name: 'Lưu thay đổi' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Lưu địa chỉ' })).not.toBeInTheDocument();
    });

    it('sửa một ô rồi lưu -> onSubmit nhận ĐỦ 5 ô (giá trị cũ + ô đã sửa)', async () => {
      const user = userEvent.setup();
      const { onSubmit } = renderForm({ initialValues: existing });

      const line1 = screen.getByLabelText('Số nhà, tên đường');
      await user.clear(line1);
      await user.type(line1, '99 Hai Bà Trưng');
      await user.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));

      await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
      expect(onSubmit.mock.calls[0][0]).toEqual({ ...existing, line1: '99 Hai Bà Trưng' });
    });

    it('initialValues đổi sang địa chỉ khác -> form điền lại theo địa chỉ mới (dùng `values`, không phải `defaultValues`)', () => {
      const other = { ...existing, recipientName: 'Lê Văn C', province: 'Hồ Chí Minh' };
      const { rerender } = render(
        withIntl(<AddressForm onSubmit={vi.fn()} initialValues={existing} />),
      );

      rerender(withIntl(<AddressForm onSubmit={vi.fn()} initialValues={other} />));

      expect(screen.getByLabelText('Họ tên người nhận')).toHaveValue('Lê Văn C');
      expect(screen.getByLabelText('Tỉnh/Thành phố')).toHaveValue('Hồ Chí Minh');
    });

    it('ô sửa thành giá trị sai -> vẫn chặn bằng cùng luật validate như tạo mới', async () => {
      const user = userEvent.setup();
      const { onSubmit } = renderForm({ initialValues: existing });

      const phone = screen.getByLabelText('Số điện thoại');
      await user.clear(phone);
      await user.type(phone, '123');
      await user.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));

      expect(await screen.findByText('Số điện thoại không hợp lệ')).toBeInTheDocument();
      expect(onSubmit).not.toHaveBeenCalled();
    });
  });

  describe('nút Hủy (onCancel)', () => {
    it('không truyền onCancel -> không có nút Hủy (form ở /checkout giữ nguyên)', () => {
      renderForm();

      expect(screen.queryByRole('button', { name: 'Hủy' })).not.toBeInTheDocument();
    });

    it('có onCancel -> bấm "Hủy" gọi onCancel và KHÔNG gửi form', async () => {
      const user = userEvent.setup();
      const onCancel = vi.fn();
      const { onSubmit } = renderForm({ onCancel });

      await user.click(screen.getByRole('button', { name: 'Hủy' }));

      expect(onCancel).toHaveBeenCalledTimes(1);
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it('đang gửi -> nút Hủy cũng bị vô hiệu', () => {
      renderForm({ onCancel: vi.fn(), isSubmitting: true });

      expect(screen.getByRole('button', { name: 'Hủy' })).toBeDisabled();
    });
  });
});
