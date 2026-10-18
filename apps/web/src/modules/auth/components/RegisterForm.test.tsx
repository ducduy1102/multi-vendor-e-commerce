import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';
import { renderServerHtml } from '@/shared/lib/test-ssr';

import { RegisterForm } from './RegisterForm';

describe('RegisterForm', () => {
  it('shows confirmPassword mismatch error and does not submit', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(withIntl(<RegisterForm onSubmit={onSubmit} />));

    await user.type(screen.getByLabelText('Họ tên'), 'Nguyen Van A');
    await user.type(screen.getByLabelText('Email'), 'user@example.com');
    await user.type(screen.getByLabelText('Mật khẩu'), 'password123');
    await user.type(screen.getByLabelText('Nhập lại mật khẩu'), 'wrongpassword');
    await user.click(screen.getByRole('button', { name: 'Đăng ký' }));

    expect(await screen.findByText('Mật khẩu nhập lại không khớp')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('calls onSubmit with validated values when confirmPassword matches', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(withIntl(<RegisterForm onSubmit={onSubmit} />));

    await user.type(screen.getByLabelText('Họ tên'), 'Nguyen Van A');
    await user.type(screen.getByLabelText('Email'), 'user@example.com');
    await user.type(screen.getByLabelText('Mật khẩu'), 'password123');
    await user.type(screen.getByLabelText('Nhập lại mật khẩu'), 'password123');
    await user.click(screen.getByRole('button', { name: 'Đăng ký' }));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        {
          name: 'Nguyen Van A',
          email: 'user@example.com',
          password: 'password123',
          confirmPassword: 'password123',
        },
        expect.anything(),
      ),
    );
  });

  it('disables submit button while isSubmitting', () => {
    render(withIntl(<RegisterForm onSubmit={vi.fn()} isSubmitting />));

    expect(screen.getByRole('button', { name: 'Đang đăng ký...' })).toBeDisabled();
  });
});

// Bảo mật (Week10.md 2.2): bấm "gửi" trước khi React hydrate xong thì trình duyệt tự gửi form theo kiểu GET và
// dữ liệu đã nhập (mật khẩu) lên thẳng URL. Hai lớp chặn: nút gửi bị khoá ngay trong HTML server render, và
// form khai method="post" để dù lọt vẫn không đưa dữ liệu lên URL. Render phía client của RTL không thấy được
// trạng thái trước hydrate nên dùng renderServerHtml.
describe('RegisterForm — trước và sau hydrate', () => {
  it('HTML do server render: form method="post" và nút gửi bị khoá', () => {
    const doc = renderServerHtml(withIntl(<RegisterForm onSubmit={vi.fn()} />));

    expect(doc.querySelector('form')?.getAttribute('method')).toBe('post');
    expect(doc.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);
  });

  it('sau khi mount phía client: nút gửi mở khoá và form vẫn method="post"', () => {
    const { container } = render(withIntl(<RegisterForm onSubmit={vi.fn()} />));

    expect(container.querySelector('button[type="submit"]')).toBeEnabled();
    expect(container.querySelector('form')).toHaveAttribute('method', 'post');
  });
});
