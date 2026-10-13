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
import { Input } from '@/shared/components/ui/input';
import { Label } from '@/shared/components/ui/label';
import { useValidationMessage } from '@/shared/hooks/useValidationMessage';

import { adminMarkRefundCompletedSchema } from '../schemas/admin.schema';
import type { AdminMarkRefundCompletedInput } from '../types';

interface MarkRefundCompletedDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isPending: boolean;
  onConfirm: (reference: string) => void;
}

// Ghi nhận một khoản hoàn ĐÃ làm tay trên trang merchant của cổng: sổ cái chuyển sang "đã hoàn" mà không gọi cổng
// nữa, nên Admin phải xác nhận mình thật sự đã hoàn (hoàn hai lần là mất tiền thật) và MÃ THAM CHIẾU BẮT BUỘC để
// sau này đối soát được khoản này với giao dịch hoàn bên cổng. Form chỉ mount khi hộp thoại mở. Nút xác nhận là
// `Button` thường (không phải AlertDialogAction) để giữ hộp thoại mở tới khi yêu cầu xong.
function MarkRefundCompletedForm({
  isPending,
  onConfirm,
}: Pick<MarkRefundCompletedDialogProps, 'isPending' | 'onConfirm'>) {
  const t = useTranslations('admin');
  const translateValidation = useValidationMessage();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<AdminMarkRefundCompletedInput>({
    resolver: zodResolver(adminMarkRefundCompletedSchema),
    defaultValues: { reference: '' },
  });

  return (
    <form
      onSubmit={handleSubmit((values) => onConfirm(values.reference))}
      noValidate
      className="flex flex-col gap-4"
    >
      <AlertDialogHeader>
        <AlertDialogTitle>{t('refundsMarkCompletedTitle')}</AlertDialogTitle>
        <AlertDialogDescription>{t('refundsMarkCompletedDescription')}</AlertDialogDescription>
      </AlertDialogHeader>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="admin-refund-reference">{t('refundsMarkCompletedReferenceLabel')}</Label>
        <Input
          id="admin-refund-reference"
          autoComplete="off"
          aria-invalid={errors.reference ? true : undefined}
          aria-describedby={errors.reference ? 'admin-refund-reference-error' : undefined}
          {...register('reference')}
        />
        {errors.reference ? (
          <p id="admin-refund-reference-error" role="alert" className="text-sm text-destructive">
            {translateValidation(errors.reference.message)}
          </p>
        ) : null}
      </div>

      <AlertDialogFooter>
        <AlertDialogCancel disabled={isPending}>{t('dialogBack')}</AlertDialogCancel>
        <Button type="submit" disabled={isPending}>
          {t('refundsMarkCompletedConfirm')}
        </Button>
      </AlertDialogFooter>
    </form>
  );
}

export function MarkRefundCompletedDialog({
  open,
  onOpenChange,
  isPending,
  onConfirm,
}: MarkRefundCompletedDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <MarkRefundCompletedForm isPending={isPending} onConfirm={onConfirm} />
      </AlertDialogContent>
    </AlertDialog>
  );
}
