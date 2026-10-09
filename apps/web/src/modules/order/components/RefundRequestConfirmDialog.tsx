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

export type RefundRequestConfirmVariant = 'withdraw' | 'escalate';

interface RefundRequestConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // withdraw = rút yêu cầu (seller chưa trả lời); escalate = khiếu nại lên sàn (seller đã từ chối).
  variant: RefundRequestConfirmVariant;
  isPending: boolean;
  onConfirm: () => void;
}

// Chỉ khác nhau ở chữ nên dùng chung một hộp thoại: cả hai đều là bước khó đảo ngược (rút xong phải gửi lại từ
// đầu, khiếu nại chỉ được một lần) nên có xác nhận. Nút xác nhận giữ hộp thoại mở (khoá) tới khi yêu cầu xong,
// giống ConfirmReceivedDialog. Nút xác nhận trung tính (không đỏ): không phải hành động phá huỷ dữ liệu.
const COPY = {
  withdraw: {
    title: 'withdrawDialogTitle',
    description: 'withdrawDialogDescription',
    confirm: 'withdrawDialogConfirm',
    cancel: 'withdrawDialogKeep',
  },
  escalate: {
    title: 'escalateDialogTitle',
    description: 'escalateDialogDescription',
    confirm: 'escalateDialogConfirm',
    cancel: 'dialogBack',
  },
} as const;

export function RefundRequestConfirmDialog({
  open,
  onOpenChange,
  variant,
  isPending,
  onConfirm,
}: RefundRequestConfirmDialogProps) {
  const t = useTranslations('order');
  const copy = COPY[variant];

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t(copy.title)}</AlertDialogTitle>
          <AlertDialogDescription>{t(copy.description)}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>{t(copy.cancel)}</AlertDialogCancel>
          <Button type="button" disabled={isPending} onClick={onConfirm}>
            {t(copy.confirm)}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
