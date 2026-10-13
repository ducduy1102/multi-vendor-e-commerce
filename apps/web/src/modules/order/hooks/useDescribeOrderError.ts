import { useTranslations } from 'next-intl';

import type { LooseTranslator } from '@/shared/hooks/useValidationMessage';
import { ApiError } from '@/shared/lib/api-client';
import { ERROR_CODE_MESSAGE_KEYS, getErrorCode, getErrorDetails } from '@/shared/lib/error-codes';

// Lý do cụ thể của REFUND_REQUEST_NOT_ALLOWED (details.reason, Week9.md 1.3) -> key i18n (namespace `order`).
// Cùng một mã lỗi mà nguyên nhân rất khác nhau (quá hạn, đã có yêu cầu, sai trạng thái, chưa thu được tiền) nên
// câu chung "không gửi được yêu cầu" khiến người mua không biết cần làm gì tiếp. `WINDOW_EXPIRED` dùng cho cả
// cửa sổ trả hàng lẫn cửa sổ khiếu nại nên câu viết chung cho "thao tác này".
const REFUND_NOT_ALLOWED_REASON_KEYS = {
  NOT_ELIGIBLE_STATUS: 'errorRefundNotEligible',
  WINDOW_EXPIRED: 'errorRefundWindowExpired',
  ALREADY_REQUESTED: 'errorRefundAlreadyRequested',
  PAYMENT_NOT_COLLECTED: 'errorRefundPaymentNotCollected',
} as const;

// Lỗi của một hành động trên đơn -> câu hiển thị cho người dùng: lỗi có `code` nghiệp vụ của BE
// được dịch theo bảng mã lỗi dùng chung (không lộ message tiếng Anh của BE), còn lại (mất mạng, lỗi
// lạ) là câu chung "không thể hoàn tất, thử lại". Dùng chung cho luồng hành động của người mua và
// của Seller. Riêng REFUND_REQUEST_NOT_ALLOWED có câu theo từng `details.reason`; `details` là dữ liệu ngoài
// nên đi qua getErrorDetails (Zod) — sai hình dạng/thiếu thì rơi về câu chung của mã, không vỡ.
export function useDescribeOrderError(): (error: unknown) => string {
  const t = useTranslations('order');
  const tGlobal = useTranslations() as unknown as LooseTranslator;

  return (error) => {
    if (error instanceof ApiError) {
      const code = getErrorCode(error);
      if (code === 'REFUND_REQUEST_NOT_ALLOWED') {
        const details = getErrorDetails(error.details, code);
        if (details) return t(REFUND_NOT_ALLOWED_REASON_KEYS[details.reason]);
      }
      if (code) return tGlobal(ERROR_CODE_MESSAGE_KEYS[code]);
    }
    return t('actionError');
  };
}
