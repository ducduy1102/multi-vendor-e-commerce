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

interface ConfirmReceivedDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isPending: boolean;
  onConfirm: () => void;
}

// "Đã nhận hàng" là bước khó đảo ngược (đơn COD sẽ được ghi nhận đã thu tiền, đơn hoàn tất) nên
// có xác nhận. Nút xác nhận giữ hộp thoại mở (khoá) tới khi yêu cầu xong, giống CancelOrderDialog.
export function ConfirmReceivedDialog({
  open,
  onOpenChange,
  isPending,
  onConfirm,
}: ConfirmReceivedDialogProps) {
  const t = useTranslations('order');

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('confirmReceivedDialogTitle')}</AlertDialogTitle>
          <AlertDialogDescription>{t('confirmReceivedDialogDescription')}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>{t('dialogBack')}</AlertDialogCancel>
          <Button type="button" disabled={isPending} onClick={onConfirm}>
            {t('confirmReceivedDialogConfirm')}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
