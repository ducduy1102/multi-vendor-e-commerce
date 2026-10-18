'use client';

import type { ErrorCode } from '@ecommerce/types';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { Button } from '@/shared/components/ui/button';
import type { LooseTranslator } from '@/shared/hooks/useValidationMessage';
import { ApiError } from '@/shared/lib/api-client';
import { ERROR_CODE_MESSAGE_KEYS, getErrorCode } from '@/shared/lib/error-codes';

import { resendVerification } from '../services/auth.service';

interface ResendVerificationButtonProps {
  size?: 'default' | 'sm';
}

// Lưu KẾT QUẢ (thành công hoặc MÃ lỗi) chứ không lưu chuỗi: chữ luôn do FE dịch theo ngôn ngữ hiện tại, không
// bao giờ hiện `message` của BE (message tiếng Anh cho log; các lỗi cũ còn là tiếng Việt cứng, ở `/en` sẽ lộ
// tiếng Việt).
type Feedback = { kind: 'success' } | { kind: 'error'; code: ErrorCode | undefined };

// Dùng lại được ở nhiều chỗ (banner toàn app, trang /verify-email khi hết
// hạn/không hợp lệ) — chỉ hoạt động khi đã đăng nhập (BE yêu cầu JwtAuthGuard),
// nơi gọi tự quyết định có hiện component này hay không dựa vào useAuthStore.
export function ResendVerificationButton({ size = 'default' }: ResendVerificationButtonProps) {
  const t = useTranslations('auth');
  // Key của bảng mã lỗi là key ĐẦY ĐỦ kèm namespace (trải trên nhiều namespace) nên dịch bằng translator
  // global, cùng cách useDescribeShopError.
  const tGlobal = useTranslations() as unknown as LooseTranslator;
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  async function handleClick() {
    setIsSubmitting(true);
    setFeedback(null);
    try {
      await resendVerification();
      setFeedback({ kind: 'success' });
    } catch (err) {
      // EMAIL_ALREADY_VERIFIED, VERIFICATION_RESEND_TOO_SOON... có câu riêng; lỗi không có mã (vd 401 hết
      // phiên) rơi về câu chung.
      setFeedback({
        kind: 'error',
        code: err instanceof ApiError ? getErrorCode(err) : undefined,
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  function feedbackText(current: Feedback): string {
    if (current.kind === 'success') return t('resendVerificationSuccess');
    return current.code
      ? tGlobal(ERROR_CODE_MESSAGE_KEYS[current.code])
      : t('resendVerificationGenericError');
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="outline" size={size} onClick={handleClick} disabled={isSubmitting}>
        {isSubmitting ? t('resendVerificationSubmitting') : t('resendVerificationSubmit')}
      </Button>
      {feedback && <p className="text-sm">{feedbackText(feedback)}</p>}
    </div>
  );
}
