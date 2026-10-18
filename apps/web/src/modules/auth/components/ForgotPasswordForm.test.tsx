import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';
import { renderServerHtml } from '@/shared/lib/test-ssr';

import { ForgotPasswordForm } from './ForgotPasswordForm';

describe('ForgotPasswordForm', () => {
  it('báo lỗi theo field và không gọi onSubmit khi để trống', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(withIntl(<ForgotPasswordForm onSubmit={onSubmit} />));

    await user.click(screen.getByRole('button', { name: 'Gửi liên kết đặt lại' }));

    expect(await screen.findByText('Email không hợp lệ')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('email sai định dạng bị chặn trước khi gửi', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(withIntl(<ForgotPasswordForm onSubmit={onSubmit} />));

    await user.type(screen.getByLabelText('Email'), 'khong-phai-email');
    await user.click(screen.getByRole('button', { name: 'Gửi liên kết đặt lại' }));

    expect(await screen.findByText('Email không hợp lệ')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('gửi email đã chuẩn hoá (cắt khoảng trắng, chữ thường) cùng schema với BE', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(withIntl(<ForgotPasswordForm onSubmit={onSubmit} />));

    await user.type(screen.getByLabelText('Email'), '  User@Example.com ');
    await user.click(screen.getByRole('button', { name: 'Gửi liên kết đặt lại' }));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({ email: 'user@example.com' }, expect.anything()),
    );
  });

  it('khoá nút gửi khi đang gửi', () => {
    render(withIntl(<ForgotPasswordForm onSubmit={vi.fn()} isSubmitting />));

    expect(screen.getByRole('button', { name: 'Đang gửi...' })).toBeDisabled();
  });
});

// Bảo mật (Week10.md 2.2): bấm "gửi" trước khi React hydrate xong thì trình duyệt tự gửi form theo kiểu GET và
// dữ liệu đã nhập (mật khẩu) lên thẳng URL. Hai lớp chặn: nút gửi bị khoá ngay trong HTML server render, và
// form khai method="post" để dù lọt vẫn không đưa dữ liệu lên URL. Render phía client của RTL không thấy được
// trạng thái trước hydrate nên dùng renderServerHtml.
describe('ForgotPasswordForm — trước và sau hydrate', () => {
  it('HTML do server render: form method="post" và nút gửi bị khoá', () => {
    const doc = renderServerHtml(withIntl(<ForgotPasswordForm onSubmit={vi.fn()} />));

    expect(doc.querySelector('form')?.getAttribute('method')).toBe('post');
    expect(doc.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);
  });

  it('sau khi mount phía client: nút gửi mở khoá và form vẫn method="post"', () => {
    const { container } = render(withIntl(<ForgotPasswordForm onSubmit={vi.fn()} />));

    expect(container.querySelector('button[type="submit"]')).toBeEnabled();
    expect(container.querySelector('form')).toHaveAttribute('method', 'post');
  });
});
