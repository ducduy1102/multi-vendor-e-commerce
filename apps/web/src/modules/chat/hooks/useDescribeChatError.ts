import { isErrorCode } from '@ecommerce/types';
import { useTranslations } from 'next-intl';

import type { LooseTranslator } from '@/shared/hooks/useValidationMessage';
import { ApiError } from '@/shared/lib/api-client';
import { ERROR_CODE_MESSAGE_KEYS, getErrorCode } from '@/shared/lib/error-codes';

import type { ChatSendFailure } from '../types';

// Lý do một tin "gửi lỗi" và lỗi tải dữ liệu chat -> câu hiển thị. Mã lỗi nghiệp vụ của BE (CHAT_*, hoặc mã chung)
// được dịch theo bảng mã lỗi dùng chung, KHÔNG lộ message tiếng Anh của BE; mất mạng dùng câu chung của app; còn lại
// là câu chung của chat.
export function useDescribeChatError() {
  const t = useTranslations('chat');
  const tGlobal = useTranslations() as unknown as LooseTranslator;

  const describeCode = (code: string | undefined): string | null =>
    code !== undefined && isErrorCode(code) ? tGlobal(ERROR_CODE_MESSAGE_KEYS[code]) : null;

  return {
    describeFailure(failure: ChatSendFailure): string {
      const byCode = describeCode(failure.code);
      if (byCode) return byCode;
      return failure.status === 0 ? tGlobal('common.errorNetwork') : t('sendFailedGeneric');
    },
    describeLoadError(error: unknown): string {
      if (error instanceof ApiError) {
        const code = getErrorCode(error);
        if (code) return tGlobal(ERROR_CODE_MESSAGE_KEYS[code]);
        if (error.status === 403 || error.status === 404) return t('errorNotParticipant');
        if (error.status === 0) return tGlobal('common.errorNetwork');
      }
      return t('loadErrorGeneric');
    },
  };
}
