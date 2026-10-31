import { useTranslations } from 'next-intl';

import type { LooseTranslator } from '@/shared/hooks/useValidationMessage';
import { reportReasonMessageKey } from '@/shared/lib/report-reason-labels';

// Mã lý do báo cáo -> nhãn đã dịch (namespace `report`, dùng chung với hộp thoại của người báo). `reasonCode` Admin nhận về là chuỗi thường:
// mã lạ (BE thêm sau) rơi về nhãn "Lý do khác" thay vì in mã thô hay làm hỏng cả danh sách.
export function useReportReasonLabel(): (code: string) => string {
  const t = useTranslations('report') as unknown as LooseTranslator;

  return (code) => t(reportReasonMessageKey(code) ?? 'reasonOther');
}
