import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

import type { ResolveReportInput } from '../types';
import { useDescribeAdminError } from './useDescribeAdminError';
import { useResolveReport } from './useResolveReport';

// Luồng xử lý MỘT báo cáo ở trang chi tiết: panel Xử lý gửi lên lựa chọn (hành động + ghi chú đã qua schema), hộp thoại xác nhận nêu hệ
// quả, bấm xác nhận mới gọi API. Thành công: toast + cache chi tiết được cập nhật nên trang tự đổi sang "Kết quả xử lý". Lỗi (409 Admin khác
// đã xử lý trước, hành động chưa được hỗ trợ...): câu đã dịch ở đầu panel và hộp thoại đóng — dữ liệu được làm mới nên panel phản ánh đúng
// trạng thái thật.
export function useAdminReportResolveFlow(reportId: string) {
  const t = useTranslations('admin');
  const describeError = useDescribeAdminError();
  const resolveReport = useResolveReport();

  // Giữ cả sau khi đóng hộp thoại để nội dung không đổi giữa chừng lúc đang chạy hiệu ứng đóng.
  const [pending, setPending] = useState<ResolveReportInput | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const isPending = resolveReport.isPending;

  function request(input: ResolveReportInput) {
    setActionError(null);
    setPending(input);
    setIsOpen(true);
  }

  // Đang gửi thì không cho đóng (Esc / bấm nền): hộp thoại tự đóng khi yêu cầu xong.
  function onOpenChange(open: boolean) {
    if (!open && isPending) return;
    setIsOpen(open);
  }

  async function confirm() {
    if (!pending) return;
    setActionError(null);
    try {
      await resolveReport.mutateAsync({ reportId, ...pending });
      toast.success(t('reportResolvedToast'));
    } catch (error) {
      setActionError(describeError(error));
    }
    setIsOpen(false);
  }

  return {
    actionError,
    isPending,
    request,
    dialog: {
      input: pending,
      isOpen,
      onOpenChange,
      isPending,
      onConfirm: () => void confirm(),
    },
  };
}
