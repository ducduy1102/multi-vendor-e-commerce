'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { useId } from 'react';
import { useForm, useWatch } from 'react-hook-form';

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/shared/components/ui/alert-dialog';
import { Alert } from '@/shared/components/ui/alert';
import { Button } from '@/shared/components/ui/button';
import { Label } from '@/shared/components/ui/label';
import { Textarea } from '@/shared/components/ui/textarea';
import { useValidationMessage } from '@/shared/hooks/useValidationMessage';
import { cn } from '@/shared/lib/utils';

import { ADMIN_USER_REASON_MAX_LENGTH, unhideReviewSchema } from '../schemas/admin.schema';
import type { UnhideReviewInput } from '../types';

interface AdminReportReopenDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isPending: boolean;
  // Lỗi (đã dịch) của lần mở lại gần nhất — vd 409 REVIEW_NOT_HIDDEN khi đánh giá đã hiển thị rồi.
  error: string | null;
  onConfirm: (reason: string) => void;
}

// Form chỉ mount khi hộp thoại mở (mỗi lần mở là một form trống). Dùng THẲNG `unhideReviewSchema` của BE: lý do bắt buộc, 1..500 ký tự,
// chuẩn hoá xuống dòng, chặn ký tự điều khiển. Lý do mở lại CHỈ ghi vào nhật ký quản trị — không gửi cho tác giả hay chủ shop.
function ReopenForm({
  isPending,
  error,
  onConfirm,
}: Pick<AdminReportReopenDialogProps, 'isPending' | 'error' | 'onConfirm'>) {
  const t = useTranslations('admin');
  const translateValidation = useValidationMessage();
  const fieldId = useId();
  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<UnhideReviewInput>({
    resolver: zodResolver(unhideReviewSchema),
    defaultValues: { reason: '' },
  });
  const length = (useWatch({ control, name: 'reason' }) ?? '').length;
  const isTooLong = length > ADMIN_USER_REASON_MAX_LENGTH;
  const hasFieldError = Boolean(errors.reason);

  return (
    <form
      onSubmit={handleSubmit((values) => onConfirm(values.reason))}
      noValidate
      className="flex flex-col gap-4"
    >
      <AlertDialogHeader>
        <AlertDialogTitle>{t('reportReopenTitle')}</AlertDialogTitle>
        <AlertDialogDescription>{t('reportReopenDescription')}</AlertDialogDescription>
      </AlertDialogHeader>

      {error ? <Alert variant="destructive">{error}</Alert> : null}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={fieldId}>{t('reportReopenReasonLabel')}</Label>
        <Textarea
          id={fieldId}
          rows={3}
          disabled={isPending}
          aria-invalid={hasFieldError ? true : undefined}
          aria-describedby={hasFieldError ? `${fieldId}-error` : undefined}
          {...register('reason')}
        />
        <div className="flex items-start justify-between gap-3">
          {errors.reason ? (
            <p id={`${fieldId}-error`} role="alert" className="text-sm text-destructive">
              {translateValidation(errors.reason.message)}
            </p>
          ) : (
            <span />
          )}
          <span
            className={cn(
              'shrink-0 text-xs tabular-nums',
              isTooLong ? 'text-destructive' : 'text-muted-foreground',
            )}
          >
            {t('notesCounter', { count: length, max: ADMIN_USER_REASON_MAX_LENGTH })}
          </span>
        </div>
      </div>

      <AlertDialogFooter>
        <AlertDialogCancel disabled={isPending}>{t('dialogBack')}</AlertDialogCancel>
        <Button type="submit" disabled={isPending} aria-busy={isPending || undefined}>
          {t('reportReopenConfirm')}
        </Button>
      </AlertDialogFooter>
    </form>
  );
}

export function AdminReportReopenDialog({
  open,
  onOpenChange,
  isPending,
  error,
  onConfirm,
}: AdminReportReopenDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto data-[size=default]:sm:max-w-md">
        <ReopenForm isPending={isPending} error={error} onConfirm={onConfirm} />
      </AlertDialogContent>
    </AlertDialog>
  );
}
