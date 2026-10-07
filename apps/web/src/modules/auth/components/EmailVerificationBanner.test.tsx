import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import { useAuthStore } from '../store/auth.store';
import { EmailVerificationBanner } from './EmailVerificationBanner';

vi.mock('../services/auth.service', () => ({
  resendVerification: vi.fn(),
}));

describe('EmailVerificationBanner', () => {
  afterEach(() => {
    cleanup();
    useAuthStore.getState().clearUser();
  });

  it('không hiện gì khi chưa đăng nhập', () => {
    render(withIntl(<EmailVerificationBanner />));

    expect(screen.queryByText(/chưa được xác thực/)).not.toBeInTheDocument();
  });

  it('không hiện gì khi email đã được xác thực', () => {
    useAuthStore.getState().setUser({
      id: 'user-1',
      email: 'user@example.com',
      name: 'Nguyen Van A',
      role: 'USER',
      emailVerifiedAt: '2026-01-01T00:00:00.000Z',
    });

    render(withIntl(<EmailVerificationBanner />));

    expect(screen.queryByText(/chưa được xác thực/)).not.toBeInTheDocument();
  });

  it('hiện banner + nút gửi lại khi đã đăng nhập nhưng chưa xác thực email', () => {
    useAuthStore.getState().setUser({
      id: 'user-1',
      email: 'user@example.com',
      name: 'Nguyen Van A',
      role: 'USER',
      emailVerifiedAt: null,
    });

    render(withIntl(<EmailVerificationBanner />));

    expect(screen.getByText(/chưa được xác thực/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Gửi lại email xác thực' })).toBeInTheDocument();
  });
});
