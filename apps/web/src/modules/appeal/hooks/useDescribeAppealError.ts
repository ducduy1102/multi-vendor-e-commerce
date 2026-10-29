import { useTranslations } from 'next-intl';

import { useApiErrorMessage, type LooseTranslator } from '@/shared/hooks/useValidationMessage';
import { ApiError } from '@/shared/lib/api-client';
import { ERROR_CODE_MESSAGE_KEYS, getErrorCode } from '@/shared/lib/error-codes';

// Lỗi khi gửi kháng nghị -> câu hiển thị cho chủ shop: lỗi có `code` nghiệp vụ (APPEAL_NOT_ALLOWED, APPEAL_ALREADY_SENT,
// EMAIL_NOT_VERIFIED...) dịch theo bảng mã lỗi dùng chung; lỗi 400 validate của BE (message là key i18n) dịch từng phần; mọi lỗi
// khác (mất mạng, lỗi lạ) là câu chung. Không bao giờ hiện message tiếng Anh thô của BE.
export function useDescribeAppealError(): (error: unknown) => string {
  const t = useTranslations('appeal');
  const tGlobal = useTranslations() as unknown as LooseTranslator;
  const translateApiMessage = useApiErrorMessage();

  return (error) => {
    if (error instanceof ApiError) {
      const code = getErrorCode(error);
      if (code) return tGlobal(ERROR_CODE_MESSAGE_KEYS[code]);
      if (error.status === 400) return translateApiMessage(error.message);
    }
    return t('genericError');
  };
}
