import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';
import { renderServerHtml } from '@/shared/lib/test-ssr';

import { ResetPasswordForm } from './ResetPasswordForm';

const SUBMIT = { name: 'Đặt lại mật khẩu' };

async function fill(newPassword: string, confirmPassword: string) {
  const user = userEvent.setup();
  // paste thay vì type: chuỗi dài (73 ký tự, 30 chữ có dấu) gõ từng phím rất chậm.
  await user.click(screen.getByLabelText('Mật khẩu mới'));
  if (newPassword) await user.paste(newPassword);
  await user.click(screen.getByLabelText('Nhập lại mật khẩu mới'));
  if (confirmPassword) await user.paste(confirmPassword);
  await user.click(screen.getByRole('button', SUBMIT));
}

describe('ResetPasswordForm', () => {
  it('báo lỗi từng field và không gọi onSubmit khi để trống', async () => {
    const onSubmit = vi.fn();
    render(withIntl(<ResetPasswordForm onSubmit={onSubmit} />));

    await fill('', '');

    expect(await screen.findByText('Mật khẩu tối thiểu 8 ký tự')).toBeInTheDocument();
    expect(screen.getByText('Vui lòng nhập lại mật khẩu')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('mật khẩu 7 ký tự bị chặn', async () => {
    const onSubmit = vi.fn();
    render(withIntl(<ResetPasswordForm onSubmit={onSubmit} />));

    await fill('1234567', '1234567');

    expect(await screen.findByText('Mật khẩu tối thiểu 8 ký tự')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('mật khẩu đúng 8 ký tự được chấp nhận (biên dưới)', async () => {
    const onSubmit = vi.fn();
    render(withIntl(<ResetPasswordForm onSubmit={onSubmit} />));

    await fill('12345678', '12345678');

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  });

  it('mật khẩu 73 ký tự ASCII bị chặn bằng thông báo tối đa 72 ký tự', async () => {
    const onSubmit = vi.fn();
    const tooLong = 'a'.repeat(73);
    render(withIntl(<ResetPasswordForm onSubmit={onSubmit} />));

    await fill(tooLong, tooLong);

    expect(await screen.findByText('Mật khẩu tối đa 72 ký tự')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('30 chữ có dấu (90 byte) bị chặn dù chưa tới 72 ký tự — bcrypt chỉ đọc 72 byte đầu', async () => {
    const onSubmit = vi.fn();
    const accented = 'ệ'.repeat(30);
    render(withIntl(<ResetPasswordForm onSubmit={onSubmit} />));

    await fill(accented, accented);

    expect(await screen.findByText(/Mật khẩu tối đa 72 byte/)).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('gắn lỗi "không khớp" vào ô nhập lại, không vào ô mật khẩu mới', async () => {
    const onSubmit = vi.fn();
    render(withIntl(<ResetPasswordForm onSubmit={onSubmit} />));

    await fill('password-moi-1', 'password-moi-2');

    const mismatch = await screen.findByText('Mật khẩu nhập lại không khớp');
    expect(mismatch).toBeInTheDocument();
    expect(screen.getByLabelText('Nhập lại mật khẩu mới')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Mật khẩu mới')).not.toHaveAttribute('aria-invalid', 'true');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('hợp lệ: gọi onSubmit với mật khẩu mới (token không phải field của form)', async () => {
    const onSubmit = vi.fn();
    render(withIntl(<ResetPasswordForm onSubmit={onSubmit} />));

    await fill('password-moi-1', 'password-moi-1');

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        { newPassword: 'password-moi-1', confirmPassword: 'password-moi-1' },
        expect.anything(),
      ),
    );
  });

  it('khoá nút gửi khi đang gửi', () => {
    render(withIntl(<ResetPasswordForm onSubmit={vi.fn()} isSubmitting />));

    expect(screen.getByRole('button', { name: 'Đang lưu...' })).toBeDisabled();
  });
});

// Bảo mật (Week10.md 2.2): bấm "gửi" trước khi React hydrate xong thì trình duyệt tự gửi form theo kiểu GET và
// dữ liệu đã nhập (mật khẩu) lên thẳng URL. Hai lớp chặn: nút gửi bị khoá ngay trong HTML server render, và
// form khai method="post" để dù lọt vẫn không đưa dữ liệu lên URL. Render phía client của RTL không thấy được
// trạng thái trước hydrate nên dùng renderServerHtml.
describe('ResetPasswordForm — trước và sau hydrate', () => {
  it('HTML do server render: form method="post" và nút gửi bị khoá', () => {
    const doc = renderServerHtml(withIntl(<ResetPasswordForm onSubmit={vi.fn()} />));

    expect(doc.querySelector('form')?.getAttribute('method')).toBe('post');
    expect(doc.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);
  });

  it('sau khi mount phía client: nút gửi mở khoá và form vẫn method="post"', () => {
    const { container } = render(withIntl(<ResetPasswordForm onSubmit={vi.fn()} />));

    expect(container.querySelector('button[type="submit"]')).toBeEnabled();
    expect(container.querySelector('form')).toHaveAttribute('method', 'post');
  });
});
