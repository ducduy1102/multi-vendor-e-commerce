'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { useForm } from 'react-hook-form';

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
import { Label } from '@/shared/components/ui/label';
import { Textarea } from '@/shared/components/ui/textarea';
import { useValidationMessage } from '@/shared/hooks/useValidationMessage';

import { adminRefundPaymentSchema } from '../schemas/admin.schema';
import type { AdminRefundPaymentInput } from '../types';

interface RefundPaymentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isPending: boolean;
  // Lý do tuỳ chọn (undefined khi bỏ trống) — ghi vào sổ cái để đối soát.
  onConfirm: (reason: string | undefined) => void;
}

// Hoàn TOÀN BỘ số tiền của một thanh toán bất thường (đến sau khi đơn đã hủy / trả hai lần): không đụng đơn hay
// kho và không hoàn tác được nên có xác nhận; lý do chỉ để ghi sổ nên tuỳ chọn. Form chỉ mount khi hộp thoại mở.
// Nút xác nhận là `Button` thường để giữ hộp thoại mở (khoá) tới khi yêu cầu xong.
function RefundPaymentForm({
  isPending,
  onConfirm,
}: Pick<RefundPaymentDialogProps, 'isPending' | 'onConfirm'>) {
  const t = useTranslations('admin');
  const translateValidation = useValidationMessage();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<AdminRefundPaymentInput>({
    resolver: zodResolver(adminRefundPaymentSchema),
    defaultValues: { reason: '' },
  });

  return (
    <form
      onSubmit={handleSubmit((values) => onConfirm(values.reason))}
      noValidate
      className="flex flex-col gap-4"
    >
      <AlertDialogHeader>
        <AlertDialogTitle>{t('refundsPaymentDialogTitle')}</AlertDialogTitle>
        <AlertDialogDescription>{t('refundsPaymentDialogDescription')}</AlertDialogDescription>
      </AlertDialogHeader>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="admin-refund-payment-reason">{t('refundsPaymentReasonLabel')}</Label>
        <Textarea
          id="admin-refund-payment-reason"
          aria-invalid={errors.reason ? true : undefined}
          aria-describedby={errors.reason ? 'admin-refund-payment-reason-error' : undefined}
          {...register('reason')}
        />
        {errors.reason ? (
          <p
            id="admin-refund-payment-reason-error"
            role="alert"
            className="text-sm text-destructive"
          >
            {translateValidation(errors.reason.message)}
          </p>
        ) : null}
      </div>

      <AlertDialogFooter>
        <AlertDialogCancel disabled={isPending}>{t('dialogBack')}</AlertDialogCancel>
        <Button type="submit" disabled={isPending}>
          {t('refundsPaymentDialogConfirm')}
        </Button>
      </AlertDialogFooter>
    </form>
  );
}

export function RefundPaymentDialog({
  open,
  onOpenChange,
  isPending,
  onConfirm,
}: RefundPaymentDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <RefundPaymentForm isPending={isPending} onConfirm={onConfirm} />
      </AlertDialogContent>
    </AlertDialog>
  );
}
