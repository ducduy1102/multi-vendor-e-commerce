import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { ApiError } from '@/shared/lib/api-client';
import { withIntl } from '@/shared/lib/test-i18n';

import { useDescribeAppealError } from './useDescribeAppealError';

function describeWith(locale: 'vi' | 'en') {
  const wrapper = ({ children }: { children: ReactNode }) => withIntl(<>{children}</>, locale);
  return renderHook(() => useDescribeAppealError(), { wrapper }).result.current;
}

describe('useDescribeAppealError', () => {
  it('mã lỗi nghiệp vụ dịch theo bảng mã lỗi dùng chung (vi)', () => {
    const describe = describeWith('vi');

    expect(describe(new ApiError('x', 409, 'APPEAL_ALREADY_SENT'))).toBe(
      'Bạn đã gửi kháng nghị cho lần khoá này rồi. Dữ liệu đã được làm mới.',
    );
    expect(describe(new ApiError('x', 409, 'APPEAL_NOT_ALLOWED'))).toBe(
      'Shop của bạn hiện không thể gửi kháng nghị. Dữ liệu đã được làm mới.',
    );
  });

  it('bản tiếng Anh không lẫn chuỗi tiếng Việt', () => {
    const describe = describeWith('en');

    expect(describe(new ApiError('x', 409, 'APPEAL_ALREADY_SENT'))).toBe(
      'You have already sent an appeal for this suspension. The data has been refreshed.',
    );
  });

  it('lỗi 400 của BE (message là key i18n) được dịch, không lộ key thô', () => {
    const describe = describeWith('vi');

    expect(describe(new ApiError('message: appeal.validationMessageTooLong', 400))).toContain(
      'tối đa 1000 ký tự',
    );
  });

  it('lỗi lạ (mất mạng, 500) ⇒ câu chung, không bao giờ hiện message tiếng Anh thô của BE', () => {
    const describe = describeWith('vi');

    expect(describe(new ApiError('Internal server error', 500))).toBe(
      'Không thể gửi kháng nghị. Vui lòng thử lại.',
    );
    expect(describe(new TypeError('Failed to fetch'))).toBe(
      'Không thể gửi kháng nghị. Vui lòng thử lại.',
    );
  });
});
