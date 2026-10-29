'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { LoaderCircle, Plus, TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId } from 'react';
import { useForm, useWatch } from 'react-hook-form';

import { Button } from '@/shared/components/ui/button';
import { Label } from '@/shared/components/ui/label';
import { Textarea } from '@/shared/components/ui/textarea';
import { useValidationMessage } from '@/shared/hooks/useValidationMessage';
import { cn } from '@/shared/lib/utils';

import {
  ADMIN_NOTE_CONTENT_MAX_LENGTH,
  adminNoteFormSchema,
  type AdminNoteFormInput,
} from '../schemas/admin.schema';

interface AdminNoteFormProps {
  isSubmitting: boolean;
  // Lỗi (đã dịch) của lần gửi gần nhất; null khi chưa có.
  error: string | null;
  // Trả `true` khi ghi chú đã được lưu — form chỉ XOÁ ô nhập khi đó; lưu lỗi thì giữ nguyên chữ vừa gõ để Admin không phải gõ lại.
  onSubmit: (content: string) => Promise<boolean>;
}

// Form thêm một ghi chú: một ô nhập (React Hook Form + Zod, schema dùng chung với BE) kèm bộ đếm ký tự. Không tự lưu — chỉ lưu khi
// bấm nút, vì ghi chú KHÔNG sửa hay xoá được nên một lần lưu nhầm là vĩnh viễn. Nút khoá khi đang gửi. Component THUẦN: mutation
// và dịch lỗi do Container nối.
export function AdminNoteForm({ isSubmitting, error, onSubmit }: AdminNoteFormProps) {
  const t = useTranslations('admin');
  const translateValidation = useValidationMessage();
  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors },
  } = useForm<AdminNoteFormInput>({
    resolver: zodResolver(adminNoteFormSchema),
    defaultValues: { content: '' },
  });
  const length = (useWatch({ control, name: 'content' }) ?? '').length;
  const isTooLong = length > ADMIN_NOTE_CONTENT_MAX_LENGTH;
  const fieldId = useId();
  const hasFieldError = Boolean(errors.content);

  const submit = handleSubmit(async (values) => {
    const isSaved = await onSubmit(values.content);
    if (isSaved) reset({ content: '' });
  });

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-1.5">
      <Label htmlFor={fieldId}>{t('notesFormLabel')}</Label>
      <Textarea
        id={fieldId}
        rows={3}
        disabled={isSubmitting}
        placeholder={t('notesPlaceholder')}
        aria-invalid={hasFieldError ? true : undefined}
        aria-describedby={hasFieldError ? `${fieldId}-error` : undefined}
        {...register('content')}
      />
      <div className="flex items-start justify-between gap-3">
        {errors.content ? (
          <p id={`${fieldId}-error`} role="alert" className="text-sm text-destructive">
            {translateValidation(errors.content.message)}
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
          {t('notesCounter', { count: length, max: ADMIN_NOTE_CONTENT_MAX_LENGTH })}
        </span>
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
      <Button
        type="submit"
        className="self-start"
        disabled={isSubmitting}
        aria-busy={isSubmitting || undefined}
      >
        {isSubmitting ? (
          <LoaderCircle
            aria-hidden="true"
            data-icon="inline-start"
            className="animate-spin motion-reduce:animate-none"
          />
        ) : (
          <Plus aria-hidden="true" data-icon="inline-start" />
        )}
        {isSubmitting ? t('notesSubmitting') : t('notesSubmit')}
      </Button>
    </form>
  );
}
