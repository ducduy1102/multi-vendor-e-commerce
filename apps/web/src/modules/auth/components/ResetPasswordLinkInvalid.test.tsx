import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import { ResetPasswordLinkInvalid } from './ResetPasswordLinkInvalid';

describe('ResetPasswordLinkInvalid', () => {
  it('hiện câu lỗi được truyền vào và đường quay lại /forgot-password', () => {
    render(withIntl(<ResetPasswordLinkInvalid message="Liên kết đã hết hạn" />));

    expect(screen.getByRole('alert')).toHaveTextContent('Liên kết đã hết hạn');
    expect(screen.getByRole('button', { name: 'Yêu cầu liên kết mới' })).toHaveAttribute(
      'href',
      '/forgot-password',
    );
  });
});
