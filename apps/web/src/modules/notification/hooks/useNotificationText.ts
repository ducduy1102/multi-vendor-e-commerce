import { useTranslations } from 'next-intl';

import type { LooseTranslator } from '@/shared/hooks/useValidationMessage';

// Dịch theo khoá ĐỘNG của namespace `notification`: `describeNotification` trả khoá (và tham số) tính lúc chạy nên không
// thể dùng bản có kiểu theo khoá tĩnh của next-intl. Dùng chung cho dòng thông báo và toast để hai nơi cùng một cách dịch.
export function useNotificationText(): LooseTranslator {
  return useTranslations('notification') as unknown as LooseTranslator;
}
