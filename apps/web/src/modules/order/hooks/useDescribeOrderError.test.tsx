import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { ApiError } from '@/shared/lib/api-client';
import { withIntl } from '@/shared/lib/test-i18n';

import { useDescribeOrderError } from './useDescribeOrderError';

const GENERIC = 'Không thực hiện được thao tác, vui lòng thử lại';

function describeWith(error: unknown) {
  const wrapper = ({ children }: { children: ReactNode }) => withIntl(<>{children}</>);
  const { result } = renderHook(() => useDescribeOrderError(), { wrapper });
  return result.current(error);
}

describe('useDescribeOrderError', () => {
  it.each([
    ['ORDER_CANCEL_NOT_ALLOWED', 409, 'Đơn hàng này hiện không thể hủy'],
    ['ORDER_ALREADY_CHANGED', 409, 'Đơn hàng vừa được cập nhật, vui lòng tải lại trang'],
    ['ORDER_NOT_FOUND', 404, 'Không tìm thấy đơn hàng'],
    [
      'ORDER_INVALID_TRANSITION',
      409,
      'Không thể thực hiện thao tác này ở trạng thái hiện tại của đơn hàng',
    ],
  ])('mã %s -> câu dịch theo mã, không lộ message tiếng Anh của BE', (code, status, expected) => {
    const message = describeWith(new ApiError(`English detail for ${code}`, status, code));

    expect(message).toBe(expected);
    expect(message).not.toContain('English detail');
  });

  it('mất mạng (mã client NETWORK_ERROR) -> câu dịch riêng của mã đó, không phải câu chung', () => {
    expect(describeWith(new ApiError('Network error', 0, 'NETWORK_ERROR'))).toBe(
      'Mất kết nối mạng, vui lòng kiểm tra và thử lại',
    );
  });

  it('mã mới BE thêm mà FE chưa biết -> câu chung, không ném lỗi, không lộ message gốc', () => {
    const message = describeWith(
      new ApiError('brand new internal detail', 409, 'SOME_FUTURE_CODE'),
    );

    expect(message).toBe(GENERIC);
    expect(message).not.toContain('internal detail');
  });

  it.each([
    ['500 không có mã', new ApiError('boom: internal detail', 500)],
    ['403 không có mã', new ApiError('Forbidden resource', 403)],
    ['lỗi lạ không phải ApiError', new Error('boom: stack trace')],
    ['giá trị không phải Error', 'chuỗi bất kỳ'],
  ])('%s -> câu chung "không thực hiện được thao tác", không lộ message gốc', (_label, error) => {
    const message = describeWith(error);

    expect(message).toBe(GENERIC);
    expect(message).not.toMatch(/boom|Forbidden/);
  });
});
