import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { ApiError } from '@/shared/lib/api-client';
import { withIntl } from '@/shared/lib/test-i18n';

import { useDescribeShopError } from './useDescribeShopError';

const FALLBACK = 'Câu chung của nơi gọi';

function describeWith(error: unknown) {
  const wrapper = ({ children }: { children: ReactNode }) => withIntl(<>{children}</>);
  const { result } = renderHook(() => useDescribeShopError(), { wrapper });
  return result.current(error, FALLBACK);
}

describe('useDescribeShopError', () => {
  it('409 SHOP_EDIT_NOT_ALLOWED -> câu dịch theo mã, không lộ message tiếng Anh của BE', () => {
    const message = describeWith(
      new ApiError(
        'Shop details cannot be edited while the shop is PENDING',
        409,
        'SHOP_EDIT_NOT_ALLOWED',
        {
          status: 'PENDING',
        },
      ),
    );

    expect(message).toBe('Không thể sửa thông tin shop ở trạng thái hiện tại.');
    expect(message).not.toContain('cannot be edited');
  });

  it('409 SHOP_INVALID_TRANSITION -> câu trung tính hứa "dữ liệu đã được làm mới", KHÔNG nhắc "danh sách"', () => {
    const message = describeWith(
      new ApiError(
        'Cannot change shop status from APPROVED to PENDING',
        409,
        'SHOP_INVALID_TRANSITION',
      ),
    );

    expect(message).toBe(
      'Trạng thái shop vừa thay đổi nên thao tác này không còn hợp lệ. Dữ liệu đã được làm mới, vui lòng kiểm tra lại.',
    );
    expect(message).not.toMatch(/danh sách/);
  });

  it('400 validate của BE (message là key i18n) -> dịch từng phần', () => {
    const message = describeWith(new ApiError('logoUrl: shop.validationLogoUrlInvalid', 400));

    expect(message).not.toContain('shop.validationLogoUrlInvalid');
    expect(message.length).toBeGreaterThan(0);
  });

  it('mất mạng (mã client NETWORK_ERROR) -> câu dịch riêng của mã đó', () => {
    expect(describeWith(new ApiError('Network error', 0, 'NETWORK_ERROR'))).toBe(
      'Mất kết nối mạng, vui lòng kiểm tra và thử lại',
    );
  });

  it.each([
    ['500 không có mã', new ApiError('boom: internal detail', 500)],
    ['lỗi lạ không phải ApiError', new Error('boom: stack trace')],
  ])('%s -> đúng câu chung của nơi gọi, không lộ message gốc', (_label, error) => {
    const message = describeWith(error);

    expect(message).toBe(FALLBACK);
    expect(message).not.toContain('boom');
  });
});
