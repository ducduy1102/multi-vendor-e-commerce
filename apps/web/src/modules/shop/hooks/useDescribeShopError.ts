import { useTranslations } from 'next-intl';

import { useApiErrorMessage, type LooseTranslator } from '@/shared/hooks/useValidationMessage';
import { ApiError } from '@/shared/lib/api-client';
import { ERROR_CODE_MESSAGE_KEYS, getErrorCode } from '@/shared/lib/error-codes';

// Lỗi khi sửa/nộp lại shop -> câu hiển thị cho chủ shop: lỗi có `code` nghiệp vụ (409 SHOP_EDIT_NOT_ALLOWED,
// SHOP_INVALID_TRANSITION...) dịch theo bảng mã lỗi dùng chung; lỗi 400 validate của BE (message là key i18n
// ghép bằng "; ") dịch từng phần; mọi lỗi khác (mất mạng, lỗi lạ) dùng câu chung `fallback` do nơi gọi truyền
// (khác nhau giữa "lưu" và "gửi duyệt lại"). Không bao giờ hiện message tiếng Anh thô của BE.
export function useDescribeShopError(): (error: unknown, fallback: string) => string {
  const tGlobal = useTranslations() as unknown as LooseTranslator;
  const translateApiMessage = useApiErrorMessage();

  return (error, fallback) => {
    if (error instanceof ApiError) {
      const code = getErrorCode(error);
      if (code) return tGlobal(ERROR_CODE_MESSAGE_KEYS[code]);
      // 400 từ ZodValidationPipe: message là các key i18n. Lỗi lạ (không có key) giữ câu chung.
      if (error.status === 400) return translateApiMessage(error.message);
    }
    return fallback;
  };
}
