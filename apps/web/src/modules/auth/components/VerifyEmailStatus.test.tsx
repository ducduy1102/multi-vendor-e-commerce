import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/shared/lib/api-client';
import { withIntl } from '@/shared/lib/test-i18n';

import { useAuthStore } from '../store/auth.store';
import { VerifyEmailStatus } from './VerifyEmailStatus';

vi.mock('../services/auth.service', () => ({
  verifyEmail: vi.fn(),
  resendVerification: vi.fn(),
  me: vi.fn(),
}));

// Chuỗi tiếng Việt CỨNG mà BE trả (auth.service.ts) — FE không bao giờ được hiện nguyên văn.
const BE_SUCCESS_MESSAGE = 'Xác thực email thành công (từ BE)';
const BE_EXPIRED_MESSAGE = 'Token xác thực đã hết hạn';
const BE_INVALID_MESSAGE = 'Token xác thực không hợp lệ';

// Ký tự chỉ có trong tiếng Việt: bản `en` mà còn ký tự này nghĩa là đang rò chuỗi tiếng Việt.
const VIETNAMESE_ONLY = /[ăâđêôơưàáạảãằắặẳẵầấậẩẫèéẹẻẽềếệểễìíịỉĩòóọỏõồốộổỗờớợởỡùúụủũừứựửữỳýỵỷỹ]/i;

const unverifiedUser = {
  id: 'user-1',
  email: 'user@example.com',
  name: 'Nguyen Van A',
  role: 'USER' as const,
  emailVerifiedAt: null,
  locale: 'vi' as const,
  hasPassword: true,
};

describe('VerifyEmailStatus', () => {
  afterEach(() => {
    cleanup();
    useAuthStore.getState().clearUser();
    vi.resetAllMocks();
  });

  it('báo thiếu token nếu không có token trong URL', async () => {
    render(withIntl(<VerifyEmailStatus token={null} />));

    expect(await screen.findByText('Thiếu token xác thực trong đường dẫn')).toBeInTheDocument();
  });

  describe('xác thực thành công', () => {
    it('chưa đăng nhập: hiện chuỗi của FE (không phải message của BE) + link đăng nhập', async () => {
      const { verifyEmail, me } = await import('../services/auth.service');
      vi.mocked(verifyEmail).mockResolvedValue({ message: BE_SUCCESS_MESSAGE });
      vi.mocked(me).mockRejectedValue(new ApiError('Unauthorized', 401));

      render(withIntl(<VerifyEmailStatus token="valid-token" />));

      expect(await screen.findByText('Xác thực email thành công')).toBeInTheDocument();
      expect(screen.queryByText(BE_SUCCESS_MESSAGE)).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Đăng nhập' })).toHaveAttribute('href', '/login');
      // me() 401 là bình thường khi chưa đăng nhập: store giữ nguyên, không lỗi.
      await waitFor(() => expect(vi.mocked(me)).toHaveBeenCalledTimes(1));
      expect(useAuthStore.getState().user).toBeNull();
    });

    it('đã đăng nhập: hỏi lại me() và cập nhật store ⇒ banner "chưa xác thực" mất ngay, nút về trang chủ', async () => {
      const { verifyEmail, me } = await import('../services/auth.service');
      vi.mocked(verifyEmail).mockResolvedValue({ message: BE_SUCCESS_MESSAGE });
      const verifiedUser = { ...unverifiedUser, emailVerifiedAt: '2026-10-18T10:00:00.000Z' };
      vi.mocked(me).mockResolvedValue(verifiedUser);
      useAuthStore.getState().setUser(unverifiedUser);

      render(withIntl(<VerifyEmailStatus token="valid-token" />));

      expect(await screen.findByText('Xác thực email thành công')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Về trang chủ' })).toHaveAttribute('href', '/');
      await waitFor(() =>
        expect(useAuthStore.getState().user?.emailVerifiedAt).toBe('2026-10-18T10:00:00.000Z'),
      );
    });

    it('me() thất bại (mất mạng) ⇒ vẫn báo thành công, store giữ nguyên, không lỗi', async () => {
      const { verifyEmail, me } = await import('../services/auth.service');
      vi.mocked(verifyEmail).mockResolvedValue({ message: BE_SUCCESS_MESSAGE });
      vi.mocked(me).mockRejectedValue(new ApiError('Network error', 0, 'NETWORK_ERROR'));
      useAuthStore.getState().setUser(unverifiedUser);

      render(withIntl(<VerifyEmailStatus token="valid-token" />));

      expect(await screen.findByText('Xác thực email thành công')).toBeInTheDocument();
      await waitFor(() => expect(vi.mocked(me)).toHaveBeenCalled());
      expect(useAuthStore.getState().user).toEqual(unverifiedUser);
    });

    it('bản en: chữ tiếng Anh, không rò chuỗi tiếng Việt của BE', async () => {
      const { verifyEmail, me } = await import('../services/auth.service');
      vi.mocked(verifyEmail).mockResolvedValue({ message: BE_SUCCESS_MESSAGE });
      vi.mocked(me).mockRejectedValue(new ApiError('Unauthorized', 401));

      const { container } = render(withIntl(<VerifyEmailStatus token="valid-token" />, 'en'));

      expect(await screen.findByText('Email verified successfully')).toBeInTheDocument();
      expect(container.textContent).not.toMatch(VIETNAMESE_ONLY);
    });
  });

  describe('xác thực thất bại', () => {
    it.each([
      ['hết hạn', BE_EXPIRED_MESSAGE],
      ['không hợp lệ', BE_INVALID_MESSAGE],
    ])(
      'token %s (VERIFY_TOKEN_INVALID), chưa đăng nhập: hiện chuỗi FE, KHÔNG hiện message BE + link đăng nhập để gửi lại',
      async (_label, beMessage) => {
        const { verifyEmail } = await import('../services/auth.service');
        vi.mocked(verifyEmail).mockRejectedValue(
          new ApiError(beMessage, 400, 'VERIFY_TOKEN_INVALID'),
        );

        render(withIntl(<VerifyEmailStatus token="bad-token" />));

        expect(
          await screen.findByText('Liên kết xác thực không hợp lệ hoặc đã hết hạn.'),
        ).toBeInTheDocument();
        expect(screen.queryByText(beMessage)).not.toBeInTheDocument();
        expect(
          screen.getByRole('button', { name: 'Đăng nhập để gửi lại email xác thực' }),
        ).toBeInTheDocument();
      },
    );

    it('token hết hạn nhưng đã đăng nhập: hiện nút gửi lại email xác thực', async () => {
      const { verifyEmail } = await import('../services/auth.service');
      vi.mocked(verifyEmail).mockRejectedValue(
        new ApiError(BE_EXPIRED_MESSAGE, 400, 'VERIFY_TOKEN_INVALID'),
      );
      useAuthStore.getState().setUser(unverifiedUser);

      render(withIntl(<VerifyEmailStatus token="expired-token" />));

      expect(
        await screen.findByText('Liên kết xác thực không hợp lệ hoặc đã hết hạn.'),
      ).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Gửi lại email xác thực' })).toBeInTheDocument();
    });

    it('mất mạng (mã NETWORK_ERROR do client sinh): hiện câu mất kết nối chung của FE, không phải "link hết hạn"', async () => {
      const { verifyEmail } = await import('../services/auth.service');
      vi.mocked(verifyEmail).mockRejectedValue(new ApiError('Network error', 0, 'NETWORK_ERROR'));

      render(withIntl(<VerifyEmailStatus token="any-token" />));

      expect(
        await screen.findByText('Mất kết nối mạng, vui lòng kiểm tra và thử lại'),
      ).toBeInTheDocument();
      expect(
        screen.queryByText('Liên kết xác thực không hợp lệ hoặc đã hết hạn.'),
      ).not.toBeInTheDocument();
    });

    // Quyết định theo MÃ, không suy ra từ status HTTP: 400 không có mã (lỗi validate, hoặc BE cũ) không được
    // tự coi là "link hết hạn".
    it.each([
      ['400 KHÔNG có mã (validate / BE cũ)', new ApiError('Token xác thực không hợp lệ', 400)],
      ['lỗi máy chủ (500) không có mã', new ApiError('Lỗi máy chủ nội bộ', 500)],
      ['mã lạ BE thêm sau, FE chưa biết', new ApiError('Mã lạ', 400, 'SOME_FUTURE_CODE')],
      ['lỗi không phải ApiError', new TypeError('Failed to fetch')],
    ])('%s: hiện thông báo lỗi chung của FE, không phải "link hết hạn"', async (_label, error) => {
      const { verifyEmail } = await import('../services/auth.service');
      vi.mocked(verifyEmail).mockRejectedValue(error);

      render(withIntl(<VerifyEmailStatus token="any-token" />));

      expect(
        await screen.findByText('Xác thực email thất bại, vui lòng thử lại'),
      ).toBeInTheDocument();
      expect(screen.queryByText('Lỗi máy chủ nội bộ')).not.toBeInTheDocument();
      expect(screen.queryByText('Token xác thực không hợp lệ')).not.toBeInTheDocument();
      expect(
        screen.queryByText('Liên kết xác thực không hợp lệ hoặc đã hết hạn.'),
      ).not.toBeInTheDocument();
    });

    it('bản en: VERIFY_TOKEN_INVALID và lỗi chung đều bằng tiếng Anh, không rò chuỗi tiếng Việt của BE', async () => {
      const { verifyEmail } = await import('../services/auth.service');

      vi.mocked(verifyEmail).mockRejectedValue(
        new ApiError(BE_EXPIRED_MESSAGE, 400, 'VERIFY_TOKEN_INVALID'),
      );
      const first = render(withIntl(<VerifyEmailStatus token="t1" />, 'en'));
      expect(
        await screen.findByText('This verification link is invalid or has expired.'),
      ).toBeInTheDocument();
      expect(first.container.textContent).not.toMatch(VIETNAMESE_ONLY);
      first.unmount();

      vi.mocked(verifyEmail).mockRejectedValue(new ApiError('Lỗi máy chủ nội bộ', 500));
      const second = render(withIntl(<VerifyEmailStatus token="t2" />, 'en'));
      expect(
        await screen.findByText('Email verification failed, please try again'),
      ).toBeInTheDocument();
      expect(second.container.textContent).not.toMatch(VIETNAMESE_ONLY);
    });
  });

  // Regression: token verify chỉ dùng được 1 lần. React StrictMode chạy mount
  // + effect 2 lần ở dev — nếu không chặn, lần gọi thứ 2 sẽ luôn nhận lỗi
  // "token không hợp lệ" dù lần đầu đã xác thực thành công.
  it('chỉ gọi verifyEmail đúng 1 lần dù StrictMode chạy effect 2 lần', async () => {
    const { verifyEmail, me } = await import('../services/auth.service');
    vi.mocked(verifyEmail).mockResolvedValue({ message: BE_SUCCESS_MESSAGE });
    vi.mocked(me).mockRejectedValue(new ApiError('Unauthorized', 401));

    render(
      withIntl(
        <StrictMode>
          <VerifyEmailStatus token="valid-token" />
        </StrictMode>,
      ),
    );

    await waitFor(() => expect(screen.getByText('Xác thực email thành công')).toBeInTheDocument());
    expect(verifyEmail).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(vi.mocked(me)).toHaveBeenCalledTimes(1));
  });
});
