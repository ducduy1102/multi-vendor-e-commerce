import { useTranslations } from 'next-intl';

import { useApiErrorMessage, type LooseTranslator } from '@/shared/hooks/useValidationMessage';
import { ApiError } from '@/shared/lib/api-client';
import { ERROR_CODE_MESSAGE_KEYS, getErrorCode } from '@/shared/lib/error-codes';

// Lỗi khi gửi báo cáo -> câu hiển thị cho người báo: lỗi có `code` nghiệp vụ (REPORT_ALREADY_OPEN, REPORT_LIMIT_REACHED,
// REPORT_TARGET_NOT_FOUND, REPORT_OWN_CONTENT, EMAIL_NOT_VERIFIED...) dịch theo bảng mã lỗi dùng chung; lỗi 400 validate của BE (message
// là key i18n) dịch từng phần; mọi lỗi khác (mất mạng, lỗi lạ) là câu chung. Không bao giờ hiện message tiếng Anh thô của BE.
export function useDescribeReportError(): (error: unknown) => string {
  const t = useTranslations('report');
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
