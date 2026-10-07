import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { ApiError } from '@/shared/lib/api-client';
import { withIntl } from '@/shared/lib/test-i18n';

import { useDescribeAdminError } from './useDescribeAdminError';

const GENERIC = 'Không thực hiện được thao tác, vui lòng thử lại';

function describeWith(error: unknown) {
  const wrapper = ({ children }: { children: ReactNode }) => withIntl(<>{children}</>);
  const { result } = renderHook(() => useDescribeAdminError(), { wrapper });
  return result.current(error);
}

describe('useDescribeAdminError', () => {
  it('409 SHOP_INVALID_TRANSITION (Admin khác vừa xử lý shop) -> câu trung tính hứa dữ liệu đã được làm mới', () => {
    const message = describeWith(
      new ApiError(
        'Cannot change shop status from APPROVED to REJECTED',
        409,
        'SHOP_INVALID_TRANSITION',
      ),
    );

    expect(message).toBe(
      'Trạng thái shop vừa thay đổi nên thao tác này không còn hợp lệ. Dữ liệu đã được làm mới, vui lòng kiểm tra lại.',
    );
    expect(message).not.toContain('Cannot change');
  });

  it('mất mạng (mã client NETWORK_ERROR) -> câu dịch riêng của mã đó', () => {
    expect(describeWith(new ApiError('Network error', 0, 'NETWORK_ERROR'))).toBe(
      'Mất kết nối mạng, vui lòng kiểm tra và thử lại',
    );
  });

  it('mã mới BE thêm mà FE chưa biết -> câu chung, không ném lỗi', () => {
    expect(describeWith(new ApiError('brand new detail', 409, 'SOME_FUTURE_CODE'))).toBe(GENERIC);
  });

  it.each([
    ['403 không có mã (không còn là Admin)', new ApiError('Forbidden resource', 403)],
    ['500 không có mã', new ApiError('boom: internal detail', 500)],
    ['lỗi lạ không phải ApiError', new Error('boom: stack trace')],
  ])('%s -> câu chung "không thực hiện được thao tác", không lộ message gốc', (_label, error) => {
    const message = describeWith(error);

    expect(message).toBe(GENERIC);
    expect(message).not.toMatch(/boom|Forbidden/);
  });
});
