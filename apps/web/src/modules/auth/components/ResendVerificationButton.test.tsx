import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/shared/lib/api-client';
import { withIntl } from '@/shared/lib/test-i18n';

import { ResendVerificationButton } from './ResendVerificationButton';

vi.mock('../services/auth.service', () => ({
  resendVerification: vi.fn(),
}));

describe('ResendVerificationButton', () => {
  it('gọi resendVerification khi bấm, hiện message trả về khi thành công', async () => {
    const { resendVerification } = await import('../services/auth.service');
    vi.mocked(resendVerification).mockResolvedValue({ message: 'Đã gửi lại email xác thực' });
    const user = userEvent.setup();

    render(withIntl(<ResendVerificationButton />));
    await user.click(screen.getByRole('button', { name: 'Gửi lại email xác thực' }));

    expect(await screen.findByText('Đã gửi lại email xác thực')).toBeInTheDocument();
    expect(resendVerification).toHaveBeenCalledTimes(1);
  });

  it('hiện đúng message lỗi từ BE khi còn trong cooldown (429)', async () => {
    const { resendVerification } = await import('../services/auth.service');
    vi.mocked(resendVerification).mockRejectedValue(
      new ApiError('Vui lòng đợi trước khi gửi lại email xác thực', 429),
    );
    const user = userEvent.setup();

    render(withIntl(<ResendVerificationButton />));
    await user.click(screen.getByRole('button', { name: 'Gửi lại email xác thực' }));

    expect(
      await screen.findByText('Vui lòng đợi trước khi gửi lại email xác thực'),
    ).toBeInTheDocument();
  });
});
