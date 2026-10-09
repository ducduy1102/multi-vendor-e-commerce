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

// Ba hành động của SHOP đều là bước không hoàn tác và đều bắt buộc LÝ DO mà bên kia đọc được, cùng giới hạn
// 500 ký tự (BE dùng chung schema cho cả ba): từ chối đơn chưa xác nhận, tự hủy đơn đã xác nhận/đóng gói, từ
// chối yêu cầu hủy/trả hàng của người mua. Chỉ khác chữ nên dùng chung một hộp thoại (cùng mẫu
// RefundRequestConfirmDialog) — sửa một lần là cả ba đúng, nhất là lỗi tràn ngang bên dưới.
const COPY = {
  rejectOrder: {
    fieldId: 'reject-order-reason',
    title: 'rejectDialogTitle',
    description: 'rejectDialogDescription',
    label: 'rejectReasonLabel',
    keep: 'rejectDialogKeep',
    confirm: 'rejectDialogConfirm',
  },
  cancelOrder: {
    fieldId: 'cancel-seller-order-reason',
    title: 'sellerCancelDialogTitle',
    description: 'sellerCancelDialogDescription',
    label: 'sellerCancelReasonLabel',
    keep: 'sellerCancelDialogKeep',
    confirm: 'sellerCancelDialogConfirm',
  },
  rejectRefund: {
    fieldId: 'reject-refund-request-note',
    title: 'refundRejectDialogTitle',
    description: 'refundRejectDialogDescription',
    label: 'refundRejectNoteLabel',
    keep: 'refundRejectDialogKeep',
    confirm: 'refundRejectDialogConfirm',
  },
} as const;

export type SellerReasonDialogVariant = keyof typeof COPY;

interface SellerReasonDialogProps {
  variant: SellerReasonDialogVariant;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isPending: boolean;
  onConfirm: (reason: string) => void;
}

// Form chỉ mount khi hộp thoại mở (mỗi lần mở là 1 form trống). Nút xác nhận KHÔNG phải AlertDialogAction —
// action đó tự đóng ngay khi bấm, còn ở đây phải giữ hộp thoại mở (nút khoá) tới khi yêu cầu xong. Nút xác nhận
// màu đỏ (destructive): đây là chỗ DUY NHẤT dùng màu đỏ, nút mở hộp thoại ở ngoài là outline trung tính.
function SellerReasonForm({
  variant,
  isPending,
  onConfirm,
}: Pick<SellerReasonDialogProps, 'variant' | 'isPending' | 'onConfirm'>) {
  const t = useTranslations('order');
  const translateValidation = useValidationMessage();
  const copy = COPY[variant];
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
        <AlertDialogTitle>{t(copy.title)}</AlertDialogTitle>
        <AlertDialogDescription>{t(copy.description)}</AlertDialogDescription>
      </AlertDialogHeader>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={copy.fieldId}>{t(copy.label)}</Label>
        <Textarea
          id={copy.fieldId}
          aria-invalid={errors.reason ? true : undefined}
          aria-describedby={errors.reason ? `${copy.fieldId}-error` : undefined}
          {...register('reason')}
        />
        {errors.reason ? (
          <p id={`${copy.fieldId}-error`} role="alert" className="text-sm text-destructive">
            {translateValidation(errors.reason.message)}
          </p>
        ) : null}
      </div>

      <AlertDialogFooter>
        <AlertDialogCancel disabled={isPending}>{t(copy.keep)}</AlertDialogCancel>
        <Button type="submit" variant="destructive" disabled={isPending}>
          {t(copy.confirm)}
        </Button>
      </AlertDialogFooter>
    </form>
  );
}

export function SellerReasonDialog({
  variant,
  open,
  onOpenChange,
  isPending,
  onConfirm,
}: SellerReasonDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      {/* `grid-cols-1` CHỦ ĐÍCH: AlertDialogContent là lưới có cột ngầm định `auto` lấy min-content của
          phần tử con — ô nhập `field-sizing: content` chứa lý do dài không dấu cách làm cả hộp thoại rộng
          bằng chuỗi (đã gặp ở hộp thoại hủy/yêu cầu của người mua, ~4385px ở 390px). */}
      <AlertDialogContent className="grid-cols-1">
        <SellerReasonForm variant={variant} isPending={isPending} onConfirm={onConfirm} />
      </AlertDialogContent>
    </AlertDialog>
  );
}
