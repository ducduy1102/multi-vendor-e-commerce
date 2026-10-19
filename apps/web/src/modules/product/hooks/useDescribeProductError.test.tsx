import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { ApiError } from '@/shared/lib/api-client';
import { withIntl } from '@/shared/lib/test-i18n';

import { useDescribeProductError } from './useDescribeProductError';

const FALLBACK = 'Câu chung của nơi gọi';

function describeWith(error: unknown, locale: 'vi' | 'en' = 'vi') {
  const wrapper = ({ children }: { children: ReactNode }) => withIntl(<>{children}</>, locale);
  const { result } = renderHook(() => useDescribeProductError(), { wrapper });
  return result.current(error, FALLBACK);
}

describe('useDescribeProductError', () => {
  it('400 PRODUCT_IMAGES_LIMIT_EXCEEDED -> câu dịch theo mã, không lộ message tiếng Anh của BE', () => {
    const message = describeWith(
      new ApiError('Variant A has 10 images, the limit is 9', 400, 'PRODUCT_IMAGES_LIMIT_EXCEEDED'),
    );

    expect(message).toBe('Có biến thể vượt số ảnh tối đa cho phép, hãy bớt ảnh rồi lưu lại');
    expect(message).not.toContain('Variant A');
  });

  it('bản en: câu tiếng Anh', () => {
    expect(
      describeWith(
        new ApiError(
          'Variant A has 10 images, the limit is 9',
          400,
          'PRODUCT_IMAGES_LIMIT_EXCEEDED',
        ),
        'en',
      ),
    ).toBe('A variant has more images than allowed, remove some and save again');
  });

  it('mất mạng (mã NETWORK_ERROR do client sinh) -> câu mất kết nối đã dịch, không phải "Network error" thô', () => {
    const message = describeWith(new ApiError('Network error', 0, 'NETWORK_ERROR'));

    expect(message).toBe('Mất kết nối mạng, vui lòng kiểm tra và thử lại');
  });

  it('400 validate của BE (message là key i18n) -> dịch từng phần', () => {
    const message = describeWith(
      new ApiError(
        'variants.0.sku: product.validationSkuRequired; variants.1.price: product.validationPricePositive',
        400,
      ),
    );

    expect(message).toBe('SKU không được để trống; Giá phải lớn hơn 0');
  });

  it('ApiError khác không có mã (vd 409 trùng SKU): giữ nguyên message như trước, không đổi hành vi', () => {
    expect(describeWith(new ApiError('SKU already exists in this shop', 409))).toBe(
      'SKU already exists in this shop',
    );
  });

  it('lỗi không phải ApiError (lỗi lạ trong form): dùng câu chung của nơi gọi', () => {
    expect(describeWith(new TypeError('x'))).toBe(FALLBACK);
    expect(describeWith(undefined)).toBe(FALLBACK);
    expect(describeWith('lỗi chuỗi')).toBe(FALLBACK);
  });
});
