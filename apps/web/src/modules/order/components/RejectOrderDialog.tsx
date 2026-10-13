'use client';

import { SellerReasonDialog } from './SellerReasonDialog';

interface RejectOrderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isPending: boolean;
  onConfirm: (reason: string) => void;
}

// Từ chối đơn COD chưa xác nhận là hành động không hoàn tác (đơn bị hủy, tồn kho được trả lại) nên nằm sau xác
// nhận, và LÝ DO BẮT BUỘC — người mua thấy đúng lý do này trên timeline đơn của họ. Toàn bộ form/hộp thoại dùng
// chung với "Hủy đơn" và "Từ chối yêu cầu" của shop (SellerReasonDialog).
export function RejectOrderDialog(props: RejectOrderDialogProps) {
  return <SellerReasonDialog variant="rejectOrder" {...props} />;
}
