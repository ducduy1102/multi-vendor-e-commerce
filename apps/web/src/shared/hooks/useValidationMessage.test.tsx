import { validationMessage } from '@ecommerce/types';
import { renderHook } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import en from '../../../messages/en.json';
import vi from '../../../messages/vi.json';
import { useValidationMessage } from './useValidationMessage';

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
