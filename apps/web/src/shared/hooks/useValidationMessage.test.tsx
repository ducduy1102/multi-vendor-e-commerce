import { validationMessage } from '@ecommerce/types';
import { renderHook } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import en from '../../../messages/en.json';
import vi from '../../../messages/vi.json';
import { useApiErrorMessage, useValidationMessage } from './useValidationMessage';

function wrapperFor(locale: 'vi' | 'en', messages: typeof vi) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <NextIntlClientProvider locale={locale} messages={messages}>
        {children}
      </NextIntlClientProvider>
    );
  };
}

describe('useValidationMessage', () => {
  it('dịch key theo locale hiện tại', () => {
    const viHook = renderHook(() => useValidationMessage(), { wrapper: wrapperFor('vi', vi) });
    const enHook = renderHook(() => useValidationMessage(), {
      wrapper: wrapperFor('en', en as unknown as typeof vi),
    });

    expect(viHook.result.current('auth.validationEmailInvalid')).toBe('Email không hợp lệ');
    expect(enHook.result.current('auth.validationEmailInvalid')).toBe('Invalid email address');
  });

  it('chèn tham số đi kèm message', () => {
    const { result } = renderHook(() => useValidationMessage(), {
      wrapper: wrapperFor('en', en as unknown as typeof vi),
    });

    expect(
      result.current(validationMessage('product.validationSkuDuplicate', { sku: 'A "1"' })),
    ).toBe('SKU "A "1"" is duplicated');
  });

  it('message không phải key thì giữ nguyên, không có message thì undefined', () => {
    const { result } = renderHook(() => useValidationMessage(), { wrapper: wrapperFor('vi', vi) });

    expect(result.current('Lỗi lạ từ nơi khác')).toBe('Lỗi lạ từ nơi khác');
    expect(result.current(undefined)).toBeUndefined();
  });
});

describe('useApiErrorMessage', () => {
  const enMessages = en as unknown as typeof vi;

  it('dịch lỗi 400 ghép nhiều issue của BE, bỏ tiền tố path', () => {
    const { result } = renderHook(() => useApiErrorMessage(), {
      wrapper: wrapperFor('en', enMessages),
    });

    expect(
      result.current('email: auth.validationEmailInvalid; name: auth.validationNameRequired'),
    ).toBe('Invalid email address; Name is required');
  });

  it('dịch issue có tham số, kể cả giá trị chứa "; "', () => {
    const { result } = renderHook(() => useApiErrorMessage(), {
      wrapper: wrapperFor('en', enMessages),
    });
    const message = `variants.0.sku: ${validationMessage('product.validationSkuDuplicate', { sku: 'A; B' })}`;

    expect(result.current(message)).toBe('SKU "A; B" is duplicated');
  });

  it('lỗi nghiệp vụ thường (không phải key) giữ nguyên, kể cả có dấu hai chấm', () => {
    const { result } = renderHook(() => useApiErrorMessage(), { wrapper: wrapperFor('vi', vi) });

    expect(result.current('Email đã được đăng ký')).toBe('Email đã được đăng ký');
    expect(result.current('Lỗi: không xác định')).toBe('Lỗi: không xác định');
  });

  it('theo locale hiện tại', () => {
    const { result } = renderHook(() => useApiErrorMessage(), { wrapper: wrapperFor('vi', vi) });

    expect(result.current('email: auth.validationEmailInvalid')).toBe('Email không hợp lệ');
  });
});
