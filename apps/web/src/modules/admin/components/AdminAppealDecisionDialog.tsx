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
import { Button } from '@/shared/components/ui/button';
import { Label } from '@/shared/components/ui/label';
import { Textarea } from '@/shared/components/ui/textarea';
import { useValidationMessage } from '@/shared/hooks/useValidationMessage';
import { cn } from '@/shared/lib/utils';

import type { AdminAppealActionTarget } from '../hooks/useAdminAppealActionFlow';
import { APPEAL_DECISION_NOTE_MAX_LENGTH, decideAppealSchema } from '../schemas/admin.schema';
import type { DecideAppealInput } from '../types';
import { ADMIN_DESTRUCTIVE_CONFIRM_BUTTON_CLASS } from './admin-caution-button.constants';

export type AdminAppealDecisionVariant = 'accept' | 'reject';

// Chữ của từng biến thể. Chấp nhận nói rõ hệ quả (shop mở khoá ngay, chủ shop nhận email + thông báo); từ chối nói rõ hệ quả ngược
// lại (shop vẫn bị khoá, không kháng nghị lại được lần khoá này, chủ shop đọc được lý do).
const COPY = {
  accept: {
    title: 'appealsAcceptTitle',
    description: 'appealsAcceptDescription',
    label: 'appealsAcceptNoteLabel',
    confirm: 'appealsAcceptConfirm',
  },
  reject: {
    title: 'appealsRejectTitle',
    description: 'appealsRejectDescription',
    label: 'appealsRejectNoteLabel',
    confirm: 'appealsRejectConfirm',
  },
} as const;

interface AdminAppealDecisionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  variant: AdminAppealDecisionVariant;
  appeal: AdminAppealActionTarget;
  isPending: boolean;
  // Chấp nhận: ghi chú tuỳ chọn (undefined khi bỏ trống). Từ chối: ghi chú đã được kiểm là bắt buộc.
  onConfirm: (note: string | undefined) => void;
}

// Quyết một kháng nghị: Admin phải ĐỌC ĐỦ lời kháng nghị và lý do đã khoá shop ngay trong hộp thoại (bảng chỉ hiện 3 dòng), rồi mới
// chọn. Ghi chú chủ shop đọc được nên TỪ CHỐI BẮT BUỘC có lý do (cùng schema BE, kiểm bằng superRefine), chấp nhận thì tuỳ chọn. Form
// chỉ mount khi hộp thoại mở (mỗi lần mở là một form trống). Nút xác nhận KHÔNG phải AlertDialogAction — action đó tự đóng ngay khi
// bấm, còn ở đây phải giữ hộp thoại mở (nút khoá) tới khi yêu cầu xong.
function AdminAppealDecisionForm({
  variant,
  appeal,
  isPending,
  onConfirm,
}: Pick<AdminAppealDecisionDialogProps, 'variant' | 'appeal' | 'isPending' | 'onConfirm'>) {
  const t = useTranslations('admin');
  const translateValidation = useValidationMessage();
  const fieldId = useId();
  const copy = COPY[variant];
  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<DecideAppealInput>({
    resolver: zodResolver(decideAppealSchema),
    defaultValues: { decision: variant === 'reject' ? 'REJECT' : 'ACCEPT', note: '' },
  });
  const length = (useWatch({ control, name: 'note' }) ?? '').length;
  const isTooLong = length > APPEAL_DECISION_NOTE_MAX_LENGTH;
  const hasFieldError = Boolean(errors.note);

  return (
    <form
      onSubmit={handleSubmit((values) => onConfirm(values.note))}
      noValidate
      className="flex flex-col gap-4"
    >
      <AlertDialogHeader>
        <AlertDialogTitle>{t(copy.title)}</AlertDialogTitle>
        <AlertDialogDescription>
          {t(copy.description, { name: appeal.shopName })}
        </AlertDialogDescription>
      </AlertDialogHeader>

      {/* Vùng cuộn được (lời kháng nghị dài tới 1.000 ký tự, lý do khoá tới 500) phải focus được bằng bàn phím để cuộn mà không cần
          chuột. LỜI KHÁNG NGHỊ ĐỨNG ĐẦU: đó là thông tin mới Admin phải đọc để quyết định; lý do khoá là điều chính Admin đã nhập
          (đứng sau để ca xấu nhất — cả hai đều dài — không che mất lời kháng nghị khi chưa cuộn). */}
      <div
        role="region"
        tabIndex={0}
        aria-label={t('appealsDialogMessageLabel')}
        className="flex max-h-60 min-w-0 flex-col gap-3 overflow-y-auto rounded-lg border border-border p-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-xs font-medium text-muted-foreground">
            {t('appealsDialogMessageLabel')}
          </span>
          <p className="whitespace-pre-line text-foreground [overflow-wrap:anywhere]">
            {appeal.message}
          </p>
        </div>
        {appeal.suspensionReason ? (
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-xs font-medium text-muted-foreground">
              {t('appealsDialogSuspensionLabel')}
            </span>
            <p className="whitespace-pre-line text-foreground [overflow-wrap:anywhere]">
              {appeal.suspensionReason}
            </p>
          </div>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={fieldId}>{t(copy.label)}</Label>
        <Textarea
          id={fieldId}
          rows={3}
          disabled={isPending}
          aria-invalid={hasFieldError ? true : undefined}
          aria-describedby={hasFieldError ? `${fieldId}-error` : undefined}
          {...register('note')}
        />
        <div className="flex items-start justify-between gap-3">
          {errors.note ? (
            <p id={`${fieldId}-error`} role="alert" className="text-sm text-destructive">
              {translateValidation(errors.note.message)}
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
            {t('notesCounter', { count: length, max: APPEAL_DECISION_NOTE_MAX_LENGTH })}
          </span>
        </div>
      </div>

      <AlertDialogFooter>
        <AlertDialogCancel disabled={isPending}>{t('dialogBack')}</AlertDialogCancel>
        <Button
          type="submit"
          variant={variant === 'reject' ? 'destructive' : 'default'}
          className={variant === 'reject' ? ADMIN_DESTRUCTIVE_CONFIRM_BUTTON_CLASS : undefined}
          disabled={isPending}
        >
          {t(copy.confirm)}
        </Button>
      </AlertDialogFooter>
    </form>
  );
}

export function AdminAppealDecisionDialog({
  open,
  onOpenChange,
  variant,
  appeal,
  isPending,
  onConfirm,
}: AdminAppealDecisionDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto data-[size=default]:sm:max-w-md">
        <AdminAppealDecisionForm
          variant={variant}
          appeal={appeal}
          isPending={isPending}
          onConfirm={onConfirm}
        />
      </AlertDialogContent>
    </AlertDialog>
  );
}
