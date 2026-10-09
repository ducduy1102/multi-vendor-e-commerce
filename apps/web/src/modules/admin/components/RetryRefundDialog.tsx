'use client';

import { useTranslations } from 'next-intl';

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/shared/components/ui/alert-dialog';
import { Button } from '@/shared/components/ui/button';

interface RetryRefundDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isPending: boolean;
  onConfirm: () => void;
}

// Thử lại gọi LẠI cổng để chuyển tiền thật cho người mua nên có xác nhận như mọi hành động hoàn tiền khác (duyệt, hoàn
// thanh toán, ghi nhận hoàn tay). Hộp thoại nói rõ hai điều Admin cần biết trước khi bấm: cổng tự loại trùng vì dùng
// đúng mã tham chiếu cũ của khoản này, và nếu đã hoàn tay trên trang quản trị của cổng thì phải dùng "Ghi nhận hoàn
// tay" chứ không thử lại (tránh hoàn hai lần). Không có ô nhập. Nút xác nhận là `Button` thường (không phải
// AlertDialogAction — action đó tự đóng ngay) để giữ hộp thoại mở + khoá tới khi yêu cầu xong, giống UnsuspendShopDialog.
export function RetryRefundDialog({
  open,
  onOpenChange,
  isPending,
  onConfirm,
}: RetryRefundDialogProps) {
  const t = useTranslations('admin');

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('refundsRetryDialogTitle')}</AlertDialogTitle>
          <AlertDialogDescription>{t('refundsRetryDialogDescription')}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>{t('dialogBack')}</AlertDialogCancel>
          <Button type="button" disabled={isPending} onClick={onConfirm}>
            {t('refundsRetryDialogConfirm')}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
