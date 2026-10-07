import { useTranslations } from 'next-intl';

import type { LooseTranslator } from '@/shared/hooks/useValidationMessage';
import { ApiError } from '@/shared/lib/api-client';
import { ERROR_CODE_MESSAGE_KEYS, getErrorCode } from '@/shared/lib/error-codes';

// Lỗi của một hành động trên đơn -> câu hiển thị cho người dùng: lỗi có `code` nghiệp vụ của BE
// được dịch theo bảng mã lỗi dùng chung (không lộ message tiếng Anh của BE), còn lại (mất mạng, lỗi
// lạ) là câu chung "không thể hoàn tất, thử lại". Dùng chung cho luồng hành động của người mua và
// của Seller.
export function useDescribeOrderError(): (error: unknown) => string {
  const t = useTranslations('order');
  const tGlobal = useTranslations() as unknown as LooseTranslator;

  return (error) => {
    if (error instanceof ApiError) {
      const code = getErrorCode(error);
      if (code) return tGlobal(ERROR_CODE_MESSAGE_KEYS[code]);
    }
    return t('actionError');
  };
}
