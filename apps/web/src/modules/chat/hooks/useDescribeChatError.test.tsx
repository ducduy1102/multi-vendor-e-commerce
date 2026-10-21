import { renderHook } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { ApiError } from '@/shared/lib/api-client';

import enMessages from '../../../../messages/en.json';
import viMessages from '../../../../messages/vi.json';
import { useDescribeChatError } from './useDescribeChatError';

function wrapperFor(locale: 'vi' | 'en') {
  return function IntlWrapper({ children }: { children: ReactNode }) {
    return (
      <NextIntlClientProvider locale={locale} messages={locale === 'vi' ? viMessages : enMessages}>
        {children}
      </NextIntlClientProvider>
    );
  };
}

function setup(locale: 'vi' | 'en' = 'vi') {
  return renderHook(() => useDescribeChatError(), { wrapper: wrapperFor(locale) }).result.current;
}

describe('useDescribeChatError', () => {
  describe('describeFailure (lý do một tin gửi lỗi)', () => {
    it.each([
      ['CHAT_RATE_LIMITED', 'Bạn gửi tin quá nhanh, vui lòng chờ một chút'],
      ['CHAT_AWAITING_REPLY', 'Bạn đã gửi nhiều tin liên tiếp, hãy chờ shop phản hồi'],
      ['CHAT_SHOP_UNAVAILABLE', 'Shop hiện không nhận tin nhắn mới'],
      ['CHAT_NOT_PARTICIPANT', 'Bạn không có quyền xem cuộc trò chuyện này'],
    ])('mã %s ⇒ câu đã dịch, không lộ message của BE', (code, expected) => {
      expect(setup().describeFailure({ status: 429, code })).toBe(expected);
    });

    it('bản tiếng Anh dịch theo en.json', () => {
      expect(setup('en').describeFailure({ status: 429, code: 'CHAT_RATE_LIMITED' })).toBe(
        "You're sending messages too fast, please wait a moment",
      );
    });

    it('mất mạng (status 0, không code) ⇒ câu mất kết nối chung của app', () => {
      expect(setup().describeFailure({ status: 0 })).toBe(
        'Mất kết nối mạng, vui lòng kiểm tra và thử lại',
      );
    });

    it('mã lạ hoặc lỗi không mã ⇒ câu chung của chat (không văng key thô)', () => {
      expect(setup().describeFailure({ status: 500 })).toBe('Không gửi được tin nhắn');
      expect(setup().describeFailure({ status: 500, code: 'MA_LA_CHUA_BIET' })).toBe(
        'Không gửi được tin nhắn',
      );
    });
  });

  describe('describeLoadError (lỗi tải dữ liệu chat)', () => {
    it('ApiError có mã nghiệp vụ ⇒ dịch theo mã', () => {
      expect(setup().describeLoadError(new ApiError('x', 403, 'CHAT_NOT_PARTICIPANT'))).toBe(
        'Bạn không có quyền xem cuộc trò chuyện này',
      );
    });

    it.each([403, 404])(
      '%i không mã ⇒ "không có quyền xem" (không phân biệt tồn tại hay không)',
      (status) => {
        expect(setup().describeLoadError(new ApiError('x', status))).toBe(
          'Bạn không có quyền xem cuộc trò chuyện này',
        );
      },
    );

    it('mất mạng (status 0) ⇒ câu mất kết nối', () => {
      expect(setup().describeLoadError(new ApiError('x', 0))).toBe(
        'Mất kết nối mạng, vui lòng kiểm tra và thử lại',
      );
    });

    it('lỗi khác hoặc không phải ApiError ⇒ câu chung', () => {
      expect(setup().describeLoadError(new ApiError('x', 500))).toBe(
        'Không tải được tin nhắn, vui lòng thử lại.',
      );
      expect(setup().describeLoadError(new Error('boom'))).toBe(
        'Không tải được tin nhắn, vui lòng thử lại.',
      );
      expect(setup().describeLoadError('chuỗi')).toBe('Không tải được tin nhắn, vui lòng thử lại.');
    });
  });
});
