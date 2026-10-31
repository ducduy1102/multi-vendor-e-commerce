import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { ApiError } from '@/shared/lib/api-client';
import { withIntl } from '@/shared/lib/test-i18n';

import { useDescribeReportError } from './useDescribeReportError';

function describeWith(locale: 'vi' | 'en') {
  const wrapper = ({ children }: { children: ReactNode }) => withIntl(<>{children}</>, locale);
  return renderHook(() => useDescribeReportError(), { wrapper }).result.current;
}

describe('useDescribeReportError', () => {
  it.each([
    ['REPORT_ALREADY_OPEN', 'Bạn đã có một báo cáo đang chờ xử lý về nội dung này.'],
    [
      'REPORT_LIMIT_REACHED',
      'Bạn đã gửi quá nhiều báo cáo trong 24 giờ qua. Vui lòng thử lại sau.',
    ],
    ['REPORT_TARGET_NOT_FOUND', 'Không tìm thấy nội dung cần báo cáo.'],
    ['REPORT_OWN_CONTENT', 'Bạn không thể báo cáo nội dung của chính mình.'],
  ])('mã lỗi %s dịch theo bảng mã lỗi dùng chung (vi)', (code, expected) => {
    expect(describeWith('vi')(new ApiError('x', 409, code))).toBe(expected);
  });

  it('bản tiếng Anh không lẫn chuỗi tiếng Việt', () => {
    expect(describeWith('en')(new ApiError('x', 409, 'REPORT_OWN_CONTENT'))).toBe(
      'You cannot report your own content.',
    );
  });

  it('chưa xác thực email (403 EMAIL_NOT_VERIFIED) có câu riêng, không rơi về câu chung', () => {
    const message = describeWith('vi')(new ApiError('x', 403, 'EMAIL_NOT_VERIFIED'));

    expect(message).not.toBe('Không thể gửi báo cáo. Vui lòng thử lại.');
    expect(message).toMatch(/xác thực/i);
  });

  it('lỗi 400 của BE (message là key i18n) được dịch, không lộ key thô', () => {
    const message = describeWith('vi')(new ApiError('note: report.validationNoteTooLong', 400));

    expect(message).toContain('tối đa 500 ký tự');
    expect(message).not.toContain('report.validation');
  });

  it('lỗi lạ (mất mạng, 500) ⇒ câu chung, không bao giờ hiện message tiếng Anh thô của BE', () => {
    const describe = describeWith('vi');

    expect(describe(new ApiError('Internal server error', 500))).toBe(
      'Không thể gửi báo cáo. Vui lòng thử lại.',
    );
    expect(describe(new TypeError('Failed to fetch'))).toBe(
      'Không thể gửi báo cáo. Vui lòng thử lại.',
    );
  });
});
