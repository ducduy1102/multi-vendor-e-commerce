import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { ApiError } from '@/shared/lib/api-client';
import { withIntl } from '@/shared/lib/test-i18n';

import { useDescribeAppealError } from './useDescribeAppealError';

function describeWith(locale: 'vi' | 'en', kind?: 'shop' | 'product') {
  const wrapper = ({ children }: { children: ReactNode }) => withIntl(<>{children}</>, locale);
  return renderHook(() => useDescribeAppealError(kind), { wrapper }).result.current;
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

  it('mặc định là kháng nghị shop: truyền kind="shop" cho cùng kết quả', () => {
    const error = new ApiError('x', 409, 'APPEAL_NOT_ALLOWED');

    expect(describeWith('vi', 'shop')(error)).toBe(describeWith('vi')(error));
  });

  it('kháng nghị SẢN PHẨM: hai mã 409 của kháng nghị dùng câu riêng nói về sản phẩm / lần gỡ (không nhắc "shop" hay "khoá")', () => {
    const describe = describeWith('vi', 'product');

    expect(describe(new ApiError('x', 409, 'APPEAL_ALREADY_SENT'))).toBe(
      'Bạn đã gửi kháng nghị cho lần gỡ này rồi. Dữ liệu đã được làm mới.',
    );
    expect(describe(new ApiError('x', 409, 'APPEAL_NOT_ALLOWED'))).toBe(
      'Sản phẩm này hiện không thể gửi kháng nghị. Dữ liệu đã được làm mới.',
    );
  });

  it('kháng nghị sản phẩm, bản tiếng Anh không lẫn chuỗi tiếng Việt', () => {
    const describe = describeWith('en', 'product');

    expect(describe(new ApiError('x', 409, 'APPEAL_ALREADY_SENT'))).toBe(
      'You have already sent an appeal for this take-down. The data has been refreshed.',
    );
    expect(describe(new ApiError('x', 409, 'APPEAL_NOT_ALLOWED'))).toBe(
      'This product cannot be appealed right now. The data has been refreshed.',
    );
  });

  it('kháng nghị sản phẩm: các mã lỗi KHÁC (vd chưa xác thực email) vẫn dịch theo bảng mã lỗi dùng chung', () => {
    const shopSide = describeWith('vi', 'shop')(new ApiError('x', 403, 'EMAIL_NOT_VERIFIED'));
    const productSide = describeWith('vi', 'product')(new ApiError('x', 403, 'EMAIL_NOT_VERIFIED'));

    expect(productSide).toBe(shopSide);
    expect(productSide).not.toBe('Không thể gửi kháng nghị. Vui lòng thử lại.');
  });

  it('kháng nghị sản phẩm: lỗi lạ vẫn là câu chung, lỗi 400 vẫn được dịch', () => {
    const describe = describeWith('vi', 'product');

    expect(describe(new TypeError('Failed to fetch'))).toBe(
      'Không thể gửi kháng nghị. Vui lòng thử lại.',
    );
    expect(describe(new ApiError('message: appeal.validationMessageTooLong', 400))).toContain(
      'tối đa 1000 ký tự',
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
