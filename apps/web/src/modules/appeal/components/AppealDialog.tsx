'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { LoaderCircle, Send, TriangleAlert } from 'lucide-react';
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

import {
  APPEAL_MESSAGE_MAX_LENGTH,
  createAppealSchema,
  type AppealFormInput,
} from '../schemas/appeal.schema';

interface AppealDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isPending: boolean;
  // Lỗi (đã dịch) của lần gửi gần nhất; null khi chưa có.
  error: string | null;
  // Trả `true` khi kháng nghị đã được gửi — nơi gọi tự đóng hộp thoại; gửi lỗi thì giữ nguyên chữ vừa gõ để chủ shop không phải
  // gõ lại.
  onSubmit: (message: string) => Promise<boolean>;
}

// Form chỉ mount khi hộp thoại mở (mỗi lần mở là một form trống). Nút gửi KHÔNG phải AlertDialogAction — action đó tự đóng ngay
// khi bấm, còn ở đây phải giữ hộp thoại mở (nút khoá) tới khi yêu cầu xong, và giữ lại chữ đã gõ khi gửi lỗi.
function AppealForm({
  isPending,
  error,
  onSubmit,
}: Omit<AppealDialogProps, 'open' | 'onOpenChange'>) {
  const t = useTranslations('appeal');
  const translateValidation = useValidationMessage();
  const fieldId = useId();
  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<AppealFormInput>({
    resolver: zodResolver(createAppealSchema),
    defaultValues: { message: '' },
  });
  const length = (useWatch({ control, name: 'message' }) ?? '').length;
  const isTooLong = length > APPEAL_MESSAGE_MAX_LENGTH;
  const hasFieldError = Boolean(errors.message);

  return (
    <form
      onSubmit={handleSubmit(async (values) => {
        await onSubmit(values.message);
      })}
      noValidate
      className="flex flex-col gap-4"
    >
      <AlertDialogHeader>
        <AlertDialogTitle>{t('dialogTitle')}</AlertDialogTitle>
        <AlertDialogDescription>{t('dialogDescription')}</AlertDialogDescription>
      </AlertDialogHeader>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={fieldId}>{t('messageLabel')}</Label>
        <Textarea
          id={fieldId}
          rows={6}
          disabled={isPending}
          placeholder={t('messagePlaceholder')}
          aria-invalid={hasFieldError ? true : undefined}
          aria-describedby={hasFieldError ? `${fieldId}-error` : undefined}
          {...register('message')}
        />
        <div className="flex items-start justify-between gap-3">
          {errors.message ? (
            <p id={`${fieldId}-error`} role="alert" className="text-sm text-destructive">
              {translateValidation(errors.message.message)}
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
            {t('counter', { count: length, max: APPEAL_MESSAGE_MAX_LENGTH })}
          </span>
        </div>
      </div>

      {error ? (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm"
        >
          <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-destructive" />
          <p className="text-foreground [overflow-wrap:anywhere]">{error}</p>
        </div>
      ) : null}

      <AlertDialogFooter>
        <AlertDialogCancel disabled={isPending}>{t('back')}</AlertDialogCancel>
        <Button type="submit" disabled={isPending} aria-busy={isPending || undefined}>
          {isPending ? (
            <LoaderCircle
              aria-hidden="true"
              data-icon="inline-start"
              className="animate-spin motion-reduce:animate-none"
            />
          ) : (
            <Send aria-hidden="true" data-icon="inline-start" />
          )}
          {isPending ? t('submitting') : t('submit')}
        </Button>
      </AlertDialogFooter>
    </form>
  );
}

// Kháng nghị là MỘT lần cho mỗi lần bị khoá (không sửa, không gửi lại) nên nằm sau hộp thoại có đếm ký tự thay vì một ô nhập trần
// ngay trên trang. Component THUẦN: mutation và dịch lỗi do Container nối.
export function AppealDialog({
  open,
  onOpenChange,
  isPending,
  error,
  onSubmit,
}: AppealDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto data-[size=default]:sm:max-w-md">
        <AppealForm isPending={isPending} error={error} onSubmit={onSubmit} />
      </AlertDialogContent>
    </AlertDialog>
  );
}
