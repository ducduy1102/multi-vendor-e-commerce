import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import { ProfileForm } from './ProfileForm';

function setup(props: Partial<React.ComponentProps<typeof ProfileForm>> = {}) {
  const onSubmit = vi.fn();
  render(
    withIntl(
      <ProfileForm
        email="user@example.com"
        isEmailVerified
        initialValues={{ name: 'Nguyễn Văn A', locale: 'vi' }}
        onSubmit={onSubmit}
        {...props}
      />,
    ),
  );
  return { onSubmit };
}

describe('ProfileForm', () => {
  it('điền sẵn tên và ngôn ngữ email', () => {
    setup({ initialValues: { name: 'Lê Thị C', locale: 'en' } });

    expect(screen.getByLabelText('Họ và tên')).toHaveValue('Lê Thị C');
    expect(screen.getByLabelText('Ngôn ngữ email')).toHaveValue('en');
  });

  it('email chỉ đọc: hiện đúng địa chỉ, không sửa được', async () => {
    const user = userEvent.setup();
    setup();

    const email = screen.getByLabelText('Email');
    expect(email).toHaveValue('user@example.com');
    expect(email).toHaveAttribute('readonly');

    await user.type(email, 'khac@example.com');
    expect(email).toHaveValue('user@example.com');
  });

  it('đã xác thực: huy hiệu "Đã xác thực" và KHÔNG có nút gửi lại', () => {
    setup({ isEmailVerified: true });

    expect(screen.getByText('Đã xác thực')).toBeInTheDocument();
    expect(screen.queryByText('Chưa xác thực')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Gửi lại email xác thực' }),
    ).not.toBeInTheDocument();
  });

  it('chưa xác thực: huy hiệu "Chưa xác thực" kèm nút gửi lại email xác thực', () => {
    setup({ isEmailVerified: false });

    expect(screen.getByText('Chưa xác thực')).toBeInTheDocument();
    expect(screen.queryByText('Đã xác thực')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Gửi lại email xác thực' })).toBeInTheDocument();
  });

  it('ngôn ngữ email chỉ có đúng 2 lựa chọn vi/en', () => {
    setup();

    const options = Array.from(
      (screen.getByLabelText('Ngôn ngữ email') as HTMLSelectElement).options,
    ).map((option) => [option.value, option.textContent]);
    expect(options).toEqual([
      ['vi', 'Tiếng Việt'],
      ['en', 'English'],
    ]);
  });

  it('đổi tên và ngôn ngữ rồi lưu -> onSubmit nhận đúng 2 field (email không nằm trong form)', async () => {
    const user = userEvent.setup();
    const { onSubmit } = setup();

    const name = screen.getByLabelText('Họ và tên');
    await user.clear(name);
    await user.type(name, '  Trần Văn B ');
    await user.selectOptions(screen.getByLabelText('Ngôn ngữ email'), 'en');
    await user.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toEqual({ name: 'Trần Văn B', locale: 'en' });
  });

  it('xoá hết tên -> báo lỗi theo ô, KHÔNG gọi onSubmit', async () => {
    const user = userEvent.setup();
    const { onSubmit } = setup();

    await user.clear(screen.getByLabelText('Họ và tên'));
    await user.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));

    expect(await screen.findByText('Tên không được để trống')).toBeInTheDocument();
    expect(screen.getByLabelText('Họ và tên')).toHaveAttribute('aria-invalid', 'true');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('đang lưu -> nút đổi chữ và bị vô hiệu', () => {
    setup({ isSubmitting: true });

    expect(screen.getByRole('button', { name: 'Đang lưu...' })).toBeDisabled();
  });
});
