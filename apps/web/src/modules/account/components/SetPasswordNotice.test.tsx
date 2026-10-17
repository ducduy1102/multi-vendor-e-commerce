import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import { SetPasswordNotice } from './SetPasswordNotice';

describe('SetPasswordNotice', () => {
  it('giải thích tài khoản Google chưa có mật khẩu và dẫn sang luồng quên mật khẩu', () => {
    render(withIntl(<SetPasswordNotice />));

    expect(screen.getByText(/đăng nhập bằng Google nên chưa có mật khẩu/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Đặt mật khẩu' })).toHaveAttribute(
      'href',
      '/forgot-password',
    );
  });
});
