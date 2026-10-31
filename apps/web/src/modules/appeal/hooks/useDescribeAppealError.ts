import { useTranslations } from 'next-intl';

import { useApiErrorMessage, type LooseTranslator } from '@/shared/hooks/useValidationMessage';
import { ApiError } from '@/shared/lib/api-client';
import { ERROR_CODE_MESSAGE_KEYS, getErrorCode } from '@/shared/lib/error-codes';

import { APPEAL_COPY_KEYS, type AppealKind } from '../appeal-copy';

// Lỗi khi gửi kháng nghị -> câu hiển thị cho chủ shop: lỗi có `code` nghiệp vụ (APPEAL_NOT_ALLOWED, APPEAL_ALREADY_SENT,
// EMAIL_NOT_VERIFIED...) dịch theo bảng mã lỗi dùng chung; lỗi 400 validate của BE (message là key i18n) dịch từng phần; mọi lỗi
// khác (mất mạng, lỗi lạ) là câu chung. Không bao giờ hiện message tiếng Anh thô của BE.
//
// Hai mã 409 của kháng nghị nói về "shop" trong bảng dùng chung, nên với kháng nghị SẢN PHẨM (Week11.md 5.8) được thay bằng câu riêng của
// loại đó (`APPEAL_COPY_KEYS.product`); các mã khác (kể cả EMAIL_NOT_VERIFIED) vẫn dịch theo bảng chung.
export function useDescribeAppealError(kind: AppealKind = 'shop'): (error: unknown) => string {
  const t = useTranslations('appeal');
  const tAppeal = t as unknown as LooseTranslator;
  const tGlobal = useTranslations() as unknown as LooseTranslator;
  const translateApiMessage = useApiErrorMessage();

  return (error) => {
    if (error instanceof ApiError) {
      const code = getErrorCode(error);
      if (code) {
        if (kind === 'product' && code === 'APPEAL_NOT_ALLOWED') {
          return tAppeal(APPEAL_COPY_KEYS.product.errorNotAllowed);
        }
        if (kind === 'product' && code === 'APPEAL_ALREADY_SENT') {
          return tAppeal(APPEAL_COPY_KEYS.product.errorAlreadySent);
        }
        return tGlobal(ERROR_CODE_MESSAGE_KEYS[code]);
      }
      if (error.status === 400) return translateApiMessage(error.message);
    }
    return t('genericError');
  };
}
