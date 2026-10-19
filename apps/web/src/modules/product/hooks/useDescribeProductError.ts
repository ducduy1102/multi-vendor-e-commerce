import { useTranslations } from 'next-intl';

import { useApiErrorMessage, type LooseTranslator } from '@/shared/hooks/useValidationMessage';
import { ApiError } from '@/shared/lib/api-client';
import { ERROR_CODE_MESSAGE_KEYS, getErrorCode } from '@/shared/lib/error-codes';

// Lỗi khi tạo/sửa sản phẩm -> câu hiển thị cho người bán: lỗi có `code` (PRODUCT_IMAGES_LIMIT_EXCEEDED, hoặc mã
// chung như NETWORK_ERROR) dịch theo bảng mã lỗi dùng chung; lỗi 400 validate của BE (message là các key i18n ghép
// bằng "; ") dịch từng phần; lỗi ApiError khác không có mã (vd 409 trùng SKU — BE chỉ trả chuỗi tiếng Anh) giữ
// nguyên message như trước; mọi lỗi không phải ApiError dùng câu chung `fallback` do nơi gọi truyền (khác nhau
// giữa "tạo" và "sửa").
export function useDescribeProductError(): (error: unknown, fallback: string) => string {
  const tGlobal = useTranslations() as unknown as LooseTranslator;
  const translateApiMessage = useApiErrorMessage();

  return (error, fallback) => {
    if (!(error instanceof ApiError)) return fallback;
    const code = getErrorCode(error);
    if (code) return tGlobal(ERROR_CODE_MESSAGE_KEYS[code]);
    return translateApiMessage(error.message);
  };
}
