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

import { rejectOrderSchema } from '../schemas/order.schema';
import type { RejectOrderInput } from '../types';

interface RejectOrderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isPending: boolean;
  onConfirm: (reason: string) => void;
}

// Từ chối đơn là hành động không hoàn tác (đơn bị hủy, tồn kho được trả lại) nên nằm sau xác nhận,
// và LÝ DO BẮT BUỘC — người mua thấy đúng lý do này trên timeline đơn của họ. Form chỉ mount khi
// hộp thoại mở (mỗi lần mở là 1 form trống). Nút xác nhận KHÔNG phải AlertDialogAction — action
// đó tự đóng ngay khi bấm, còn ở đây phải giữ hộp thoại mở (nút khoá) tới khi yêu cầu xong.
function RejectOrderForm({
  isPending,
  onConfirm,
}: Pick<RejectOrderDialogProps, 'isPending' | 'onConfirm'>) {
  const t = useTranslations('order');
  const translateValidation = useValidationMessage();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<RejectOrderInput>({
    resolver: zodResolver(rejectOrderSchema),
    defaultValues: { reason: '' },
  });

  return (
    <form
      onSubmit={handleSubmit((values) => onConfirm(values.reason))}
      noValidate
      className="flex flex-col gap-4"
    >
      <AlertDialogHeader>
        <AlertDialogTitle>{t('rejectDialogTitle')}</AlertDialogTitle>
        <AlertDialogDescription>{t('rejectDialogDescription')}</AlertDialogDescription>
      </AlertDialogHeader>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="reject-order-reason">{t('rejectReasonLabel')}</Label>
        <Textarea
          id="reject-order-reason"
          aria-invalid={errors.reason ? true : undefined}
          aria-describedby={errors.reason ? 'reject-order-reason-error' : undefined}
          {...register('reason')}
        />
        {errors.reason ? (
          <p id="reject-order-reason-error" role="alert" className="text-sm text-destructive">
            {translateValidation(errors.reason.message)}
          </p>
        ) : null}
      </div>

      <AlertDialogFooter>
        <AlertDialogCancel disabled={isPending}>{t('rejectDialogKeep')}</AlertDialogCancel>
        <Button type="submit" variant="destructive" disabled={isPending}>
          {t('rejectDialogConfirm')}
        </Button>
      </AlertDialogFooter>
    </form>
  );
}

export function RejectOrderDialog({
  open,
  onOpenChange,
  isPending,
  onConfirm,
}: RejectOrderDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <RejectOrderForm isPending={isPending} onConfirm={onConfirm} />
      </AlertDialogContent>
    </AlertDialog>
  );
}
