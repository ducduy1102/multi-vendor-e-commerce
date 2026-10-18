import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/shared/lib/api-client';
import { withIntl } from '@/shared/lib/test-i18n';

import { ResendVerificationButton } from './ResendVerificationButton';

vi.mock('../services/auth.service', () => ({
  resendVerification: vi.fn(),
}));

// Ký tự chỉ có trong tiếng Việt: bản `en` mà còn ký tự này nghĩa là đang rò chuỗi tiếng Việt của BE.
const VIETNAMESE_ONLY = /[ăâđêôơưàáạảãằắặẳẵầấậẩẫèéẹẻẽềếệểễìíịỉĩòóọỏõồốộổỗờớợởỡùúụủũừứựửữỳýỵỷỹ]/i;

async function clickResend(locale: 'vi' | 'en' = 'vi') {
  const user = userEvent.setup();
  const view = render(withIntl(<ResendVerificationButton />, locale));
  await user.click(
    screen.getByRole('button', {
      name: locale === 'vi' ? 'Gửi lại email xác thực' : 'Resend verification email',
    }),
  );
  return view;
}

describe('ResendVerificationButton', () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it('gọi resendVerification khi bấm, hiện chuỗi của FE (không phải message BE) khi thành công', async () => {
    const { resendVerification } = await import('../services/auth.service');
    vi.mocked(resendVerification).mockResolvedValue({ message: 'Thông điệp thô từ BE' });

    await clickResend();

    expect(await screen.findByText('Đã gửi lại email xác thực')).toBeInTheDocument();
    expect(screen.queryByText('Thông điệp thô từ BE')).not.toBeInTheDocument();
    expect(resendVerification).toHaveBeenCalledTimes(1);
  });

  it('còn trong cooldown (VERIFICATION_RESEND_TOO_SOON): hiện chuỗi FE, KHÔNG hiện message BE', async () => {
    const { resendVerification } = await import('../services/auth.service');
    vi.mocked(resendVerification).mockRejectedValue(
      new ApiError(
        'Vui lòng đợi trước khi gửi lại email xác thực',
        429,
        'VERIFICATION_RESEND_TOO_SOON',
      ),
    );

    await clickResend();

    expect(await screen.findByText('Vui lòng đợi một lát rồi thử gửi lại')).toBeInTheDocument();
    expect(
      screen.queryByText('Vui lòng đợi trước khi gửi lại email xác thực'),
    ).not.toBeInTheDocument();
  });

  it('email đã xác thực (EMAIL_ALREADY_VERIFIED): hiện chuỗi FE, KHÔNG hiện message BE', async () => {
    const { resendVerification } = await import('../services/auth.service');
    vi.mocked(resendVerification).mockRejectedValue(
      new ApiError('Email đã được xác thực', 400, 'EMAIL_ALREADY_VERIFIED'),
    );

    await clickResend();

    expect(await screen.findByText('Email của bạn đã được xác thực')).toBeInTheDocument();
    expect(screen.queryByText('Email đã được xác thực')).not.toBeInTheDocument();
  });

  it('mất mạng (mã NETWORK_ERROR do client sinh): hiện câu mất kết nối chung của FE', async () => {
    const { resendVerification } = await import('../services/auth.service');
    vi.mocked(resendVerification).mockRejectedValue(
      new ApiError('Network error', 0, 'NETWORK_ERROR'),
    );

    await clickResend();

    expect(
      await screen.findByText('Mất kết nối mạng, vui lòng kiểm tra và thử lại'),
    ).toBeInTheDocument();
  });

  // Quyết định theo MÃ, không suy ra từ status HTTP: 400/429 không có mã (BE cũ, lỗi lạ) rơi về câu chung,
  // KHÔNG tự coi là "đã xác thực" / "gửi quá nhanh".
  it.each([
    ['chưa đăng nhập (401)', new ApiError('Unauthorized', 401)],
    ['lỗi máy chủ (500)', new ApiError('Lỗi máy chủ nội bộ', 500)],
    ['400 KHÔNG có mã', new ApiError('Email đã được xác thực', 400)],
    ['429 KHÔNG có mã', new ApiError('Vui lòng đợi trước khi gửi lại email xác thực', 429)],
    ['mã lạ BE thêm sau, FE chưa biết', new ApiError('Mã lạ', 400, 'SOME_FUTURE_CODE')],
    ['lỗi không phải ApiError', new TypeError('Failed to fetch')],
  ])('%s: hiện thông báo lỗi chung của FE', async (_label, error) => {
    const { resendVerification } = await import('../services/auth.service');
    vi.mocked(resendVerification).mockRejectedValue(error);

    await clickResend();

    expect(
      await screen.findByText('Gửi lại email xác thực thất bại, vui lòng thử lại'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Lỗi máy chủ nội bộ')).not.toBeInTheDocument();
    expect(screen.queryByText('Email đã được xác thực')).not.toBeInTheDocument();
  });

  it.each([
    ['thành công', undefined, 'Verification email sent again'],
    [
      'cooldown (VERIFICATION_RESEND_TOO_SOON)',
      new ApiError(
        'Vui lòng đợi trước khi gửi lại email xác thực',
        429,
        'VERIFICATION_RESEND_TOO_SOON',
      ),
      'Please wait a moment before requesting another email',
    ],
    [
      'đã xác thực (EMAIL_ALREADY_VERIFIED)',
      new ApiError('Email đã được xác thực', 400, 'EMAIL_ALREADY_VERIFIED'),
      'Your email is already verified',
    ],
    [
      'lỗi máy chủ (500)',
      new ApiError('Lỗi máy chủ nội bộ', 500),
      'Failed to resend verification email, please try again',
    ],
  ])('bản en, %s: chữ tiếng Anh, không rò chuỗi tiếng Việt của BE', async (_label, error, text) => {
    const { resendVerification } = await import('../services/auth.service');
    if (error) vi.mocked(resendVerification).mockRejectedValue(error);
    else vi.mocked(resendVerification).mockResolvedValue({ message: 'Đã gửi lại email xác thực' });

    const { container } = await clickResend('en');

    expect(await screen.findByText(text)).toBeInTheDocument();
    expect(container.textContent).not.toMatch(VIETNAMESE_ONLY);
  });
});
