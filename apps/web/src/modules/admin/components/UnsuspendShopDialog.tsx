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

interface UnsuspendShopDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shopName: string;
  isPending: boolean;
  onConfirm: () => void;
}

// Mở khoá là xác nhận NHẸ (không cần lý do): đưa shop về APPROVED, sản phẩm hiện lại trên sàn và
// shop nhận đơn mới ngay. Nút xác nhận là `Button` thường (không phải AlertDialogAction — action đó
// tự đóng ngay) để giữ hộp thoại mở + khoá tới khi yêu cầu xong, giống ShopReasonDialog.
export function UnsuspendShopDialog({
  open,
  onOpenChange,
  shopName,
  isPending,
  onConfirm,
}: UnsuspendShopDialogProps) {
  const t = useTranslations('admin');

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('unsuspendDialogTitle')}</AlertDialogTitle>
          <AlertDialogDescription>
            {t('unsuspendDialogDescription', { name: shopName })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>{t('dialogBack')}</AlertDialogCancel>
          <Button type="button" disabled={isPending} onClick={onConfirm}>
            {t('unsuspendDialogConfirm')}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
