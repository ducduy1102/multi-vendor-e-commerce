import { useTranslations } from 'next-intl';

import type { LooseTranslator } from '@/shared/hooks/useValidationMessage';
import { ApiError } from '@/shared/lib/api-client';
import { ERROR_CODE_MESSAGE_KEYS, getErrorCode } from '@/shared/lib/error-codes';

// Lỗi của một hành động trên shop -> câu hiển thị cho Admin: lỗi có `code` nghiệp vụ của BE (vd
// SHOP_INVALID_TRANSITION khi có Admin khác vừa xử lý shop này) được dịch theo bảng mã lỗi dùng chung
// (không lộ message tiếng Anh của BE), còn lại (mất mạng, 403, lỗi lạ) là câu chung "không thể hoàn
// tất, thử lại".
export function useDescribeAdminError(): (error: unknown) => string {
  const t = useTranslations('admin');
  const tGlobal = useTranslations() as unknown as LooseTranslator;

  return (error) => {
    if (error instanceof ApiError) {
      const code = getErrorCode(error);
      if (code) return tGlobal(ERROR_CODE_MESSAGE_KEYS[code]);
    }
    return t('actionError');
  };
}
