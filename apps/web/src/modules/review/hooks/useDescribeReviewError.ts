import { useTranslations } from 'next-intl';

import type { LooseTranslator } from '@/shared/hooks/useValidationMessage';
import { ApiError } from '@/shared/lib/api-client';
import { ERROR_CODE_MESSAGE_KEYS, getErrorCode } from '@/shared/lib/error-codes';

// Lỗi của một hành động đánh giá -> câu hiển thị cho người dùng: lỗi có `code` nghiệp vụ của BE (vd
// REVIEW_NOT_ALLOWED, REVIEW_EDIT_NOT_ALLOWED) được dịch theo bảng mã lỗi dùng chung (không lộ message
// tiếng Anh của BE), còn lại (mất mạng, 403, lỗi lạ) là câu chung "không thể hoàn tất, thử lại". Dùng chung
// cho luồng viết/sửa của người mua và trả lời của seller.
export function useDescribeReviewError(): (error: unknown) => string {
  const t = useTranslations('review');
  const tGlobal = useTranslations() as unknown as LooseTranslator;

  return (error) => {
    if (error instanceof ApiError) {
      const code = getErrorCode(error);
      if (code) return tGlobal(ERROR_CODE_MESSAGE_KEYS[code]);
    }
    return t('actionError');
  };
}
