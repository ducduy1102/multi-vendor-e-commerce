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

import { cancelOrderSchema } from '../schemas/order.schema';
import type { CancelOrderInput } from '../types';

interface CancelOrderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Đơn chưa thanh toán ⇒ BE hủy CẢ NHÓM thanh toán (kể cả đơn của shop khác) — phải nói rõ trước
  // khi người dùng xác nhận. Chỉ ảnh hưởng nội dung cảnh báo; luật hủy do BE quyết định.
  isGroupCancel: boolean;
  isPending: boolean;
  // `undefined` khi để trống lý do (lý do tuỳ chọn).
  onConfirm: (reason: string | undefined) => void;
}

interface CancelOrderFormProps {
  isGroupCancel: boolean;
  isPending: boolean;
  onConfirm: (reason: string | undefined) => void;
}

// Form nằm trong component riêng vì chỉ được mount khi hộp thoại mở: mỗi lần mở là 1 form mới
// (không giữ lại lý do của lần hủy trước). Nút xác nhận KHÔNG phải AlertDialogAction — action đó
// tự đóng hộp thoại ngay khi bấm, còn ở đây phải giữ hộp thoại mở (nút khoá) tới khi yêu cầu xong.
function CancelOrderForm({ isGroupCancel, isPending, onConfirm }: CancelOrderFormProps) {
  const t = useTranslations('order');
  const translateValidation = useValidationMessage();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<CancelOrderInput>({
    resolver: zodResolver(cancelOrderSchema),
    defaultValues: { reason: '' },
  });

  return (
    <>
      <AlertDialogHeader>
        <AlertDialogTitle>{t('cancelDialogTitle')}</AlertDialogTitle>
        <AlertDialogDescription>
          {isGroupCancel ? t('cancelDialogDescriptionGroup') : t('cancelDialogDescription')}
        </AlertDialogDescription>
      </AlertDialogHeader>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="cancel-order-reason">{t('cancelReasonLabel')}</Label>
        <Textarea
          id="cancel-order-reason"
          aria-invalid={errors.reason ? true : undefined}
          aria-describedby={errors.reason ? 'cancel-order-reason-error' : undefined}
          {...register('reason')}
        />
        {errors.reason ? (
          <p id="cancel-order-reason-error" role="alert" className="text-sm text-destructive">
            {translateValidation(errors.reason.message)}
          </p>
        ) : null}
      </div>

      <AlertDialogFooter>
        <AlertDialogCancel disabled={isPending}>{t('cancelDialogKeep')}</AlertDialogCancel>
        <Button
          type="button"
          variant="destructive"
          disabled={isPending}
          onClick={handleSubmit((values) => onConfirm(values.reason))}
        >
          {t('cancelDialogConfirm')}
        </Button>
      </AlertDialogFooter>
    </>
  );
}

export function CancelOrderDialog({
  open,
  onOpenChange,
  isGroupCancel,
  isPending,
  onConfirm,
}: CancelOrderDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <CancelOrderForm
          isGroupCancel={isGroupCancel}
          isPending={isPending}
          onConfirm={onConfirm}
        />
      </AlertDialogContent>
    </AlertDialog>
  );
}
