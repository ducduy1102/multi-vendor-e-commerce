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

import { adminDecideRefundRequestSchema } from '../schemas/admin.schema';
import type { AdminDecideRefundRequestInput, RefundRequestKind } from '../types';

export type AdminDecisionVariant = 'approve' | 'reject';

// Chữ của từng biến thể. Duyệt chọn câu theo LOẠI yêu cầu: hủy thì đơn bị hủy và hoàn kho + tiền, trả hàng thì
// tiền được hoàn nhưng hàng trả về KHÔNG tự cộng vào kho (đúng hành vi BE) — nhắc rõ để Admin không hứa với người mua
// điều hệ thống không làm.
const COPY = {
  approveCancel: {
    title: 'refundsApproveCancelTitle',
    description: 'refundsApproveCancelDescription',
    label: 'refundsApproveNoteLabel',
    confirm: 'refundsApproveConfirm',
  },
  approveReturn: {
    title: 'refundsApproveReturnTitle',
    description: 'refundsApproveReturnDescription',
    label: 'refundsApproveNoteLabel',
    confirm: 'refundsApproveConfirm',
  },
  reject: {
    title: 'refundsRejectTitle',
    description: 'refundsRejectDescription',
    label: 'refundsRejectNoteLabel',
    confirm: 'refundsRejectConfirm',
  },
} as const;

interface AdminDecisionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  variant: AdminDecisionVariant;
  // Loại yêu cầu đang quyết — chỉ ảnh hưởng câu mô tả của biến thể "duyệt".
  kind: RefundRequestKind;
  isPending: boolean;
  // Duyệt: ghi chú tuỳ chọn (undefined khi bỏ trống). Từ chối: ghi chú đã được kiểm là bắt buộc.
  onConfirm: (note: string | undefined) => void;
}

// Quyết một yêu cầu hủy/trả hàng: ghi chú người mua và shop đều đọc được nên TỪ CHỐI BẮT BUỘC có lý do (cùng
// schema BE, kiểm bằng superRefine), duyệt thì tuỳ chọn. Form chỉ mount khi hộp thoại mở (mỗi lần mở là một form
// trống). Nút xác nhận KHÔNG phải AlertDialogAction — action đó tự đóng ngay khi bấm, còn ở đây phải giữ hộp thoại
// mở (nút khoá) tới khi yêu cầu xong.
function AdminDecisionForm({
  variant,
  kind,
  isPending,
  onConfirm,
}: Pick<AdminDecisionDialogProps, 'variant' | 'kind' | 'isPending' | 'onConfirm'>) {
  const t = useTranslations('admin');
  const translateValidation = useValidationMessage();
  const copy =
    COPY[variant === 'reject' ? 'reject' : kind === 'RETURN' ? 'approveReturn' : 'approveCancel'];
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<AdminDecideRefundRequestInput>({
    resolver: zodResolver(adminDecideRefundRequestSchema),
    defaultValues: { decision: variant === 'reject' ? 'REJECT' : 'APPROVE', note: '' },
  });

  return (
    <form
      onSubmit={handleSubmit((values) => onConfirm(values.note))}
      noValidate
      className="flex flex-col gap-4"
    >
      <AlertDialogHeader>
        <AlertDialogTitle>{t(copy.title)}</AlertDialogTitle>
        <AlertDialogDescription>{t(copy.description)}</AlertDialogDescription>
      </AlertDialogHeader>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="admin-decision-note">{t(copy.label)}</Label>
        <Textarea
          id="admin-decision-note"
          aria-invalid={errors.note ? true : undefined}
          aria-describedby={errors.note ? 'admin-decision-note-error' : undefined}
          {...register('note')}
        />
        {errors.note ? (
          <p id="admin-decision-note-error" role="alert" className="text-sm text-destructive">
            {translateValidation(errors.note.message)}
          </p>
        ) : null}
      </div>

      <AlertDialogFooter>
        <AlertDialogCancel disabled={isPending}>{t('dialogBack')}</AlertDialogCancel>
        <Button
          type="submit"
          variant={variant === 'reject' ? 'destructive' : 'default'}
          disabled={isPending}
        >
          {t(copy.confirm)}
        </Button>
      </AlertDialogFooter>
    </form>
  );
}

export function AdminDecisionDialog({
  open,
  onOpenChange,
  variant,
  kind,
  isPending,
  onConfirm,
}: AdminDecisionDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AdminDecisionForm
          variant={variant}
          kind={kind}
          isPending={isPending}
          onConfirm={onConfirm}
        />
      </AlertDialogContent>
    </AlertDialog>
  );
}
