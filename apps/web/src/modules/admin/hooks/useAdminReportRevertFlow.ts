import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

import { ADMIN_REPORT_REVERT_COPY, revertKindOf } from '../admin-report-display';
import type { AdminReport } from '../types';
import { useDescribeAdminError } from './useDescribeAdminError';
import { useRestoreProduct } from './useRestoreProduct';
import { useUnhideReview } from './useUnhideReview';

// Luồng HOÀN TÁC một báo cáo đã xử lý (sửa nhầm), dùng chung cho mở lại đánh giá đã ẩn (5.6) và khôi phục sản phẩm đã gỡ (5.7): nút ở thẻ
// kết quả → hộp thoại nhập lý do (bắt buộc, chỉ ghi vào nhật ký) → gọi API bằng ID ĐỐI TƯỢNG (`report.targetId`, không phải id báo cáo).
//  - Lỗi (vd 409 đã hiển thị / không còn ở trạng thái bị gỡ): câu đã dịch NGAY TRONG hộp thoại, hộp thoại giữ mở để đọc và thử lại.
//  - Đang gửi: không đóng được hộp thoại (Esc / bấm nền).
//  - "Đã hoàn tác" được nhớ THEO id báo cáo trong lần hiển thị này (không truy vấn nào của khu Admin hiển thị trạng thái hiện tại của đối
//    tượng), nên đổi sang báo cáo khác không mang cờ "đã" của báo cáo trước.
export function useAdminReportRevertFlow(report: AdminReport | undefined) {
  const t = useTranslations('admin');
  const describeError = useDescribeAdminError();
  const unhideReview = useUnhideReview();
  const restoreProduct = useRestoreProduct();

  const [isOpen, setIsOpen] = useState(false);
  const [doneForReportId, setDoneForReportId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const kind = report ? revertKindOf(report) : null;
  const isPending = unhideReview.isPending || restoreProduct.isPending;

  function open() {
    setError(null);
    setIsOpen(true);
  }

  function onOpenChange(next: boolean) {
    if (!next && isPending) return;
    setIsOpen(next);
  }

  async function confirm(reason: string) {
    if (!report || !kind) return;
    setError(null);
    try {
      if (kind === 'REVIEW') {
        await unhideReview.mutateAsync({ reviewId: report.targetId, reason });
      } else {
        await restoreProduct.mutateAsync({ productId: report.targetId, reason });
      }
      setDoneForReportId(report.id);
      setIsOpen(false);
      toast.success(t(ADMIN_REPORT_REVERT_COPY[kind].doneKey as 'reportReopenDone'));
    } catch (caught) {
      setError(describeError(caught));
    }
  }

  return {
    kind,
    isOpen,
    isPending,
    isDone: report !== undefined && doneForReportId === report.id,
    error,
    open,
    onOpenChange,
    confirm: (reason: string) => void confirm(reason),
  };
}
