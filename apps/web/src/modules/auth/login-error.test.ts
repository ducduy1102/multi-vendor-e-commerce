import { describe, expect, it } from 'vitest';

import { ApiError } from '@/shared/lib/api-client';

import en from '../../../messages/en.json';
import vi from '../../../messages/vi.json';
import { getLoginErrorMessageKey } from './login-error';

describe('getLoginErrorMessageKey', () => {
  it('tài khoản bị khoá/cấm (401 ACCOUNT_NOT_ACTIVE) -> key đã dịch, KHÔNG để lộ nguyên mã cho người dùng', () => {
    const key = getLoginErrorMessageKey(
      new ApiError('ACCOUNT_NOT_ACTIVE', 401, 'ACCOUNT_NOT_ACTIVE'),
    );

    expect(key).toBe('auth.loginGoogleErrorAccountNotActive');
    const [namespace, name] = (key as string).split('.');
    for (const messages of [vi, en] as unknown as Record<string, Record<string, string>>[]) {
      expect(messages[namespace][name]).toBeTruthy();
      expect(messages[namespace][name]).not.toContain('ACCOUNT_NOT_ACTIVE');
    }
  });

  it('sai email/mật khẩu (không có mã) -> null để form dịch message như trước', () => {
    expect(getLoginErrorMessageKey(new ApiError('Email hoặc mật khẩu không đúng', 401))).toBeNull();
  });

  it('mã lạ (BE thêm mã mới mà FE cũ chưa biết) -> null thay vì key sai', () => {
    expect(getLoginErrorMessageKey(new ApiError('x', 401, 'SOMETHING_NEW'))).toBeNull();
  });

  it('lỗi không phải ApiError (mất mạng) -> null', () => {
    expect(getLoginErrorMessageKey(new TypeError('Failed to fetch'))).toBeNull();
    expect(getLoginErrorMessageKey(undefined)).toBeNull();
  });
});
