'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { useId } from 'react';
import { useForm, useWatch } from 'react-hook-form';

import { Button } from '@/shared/components/ui/button';
import { Label } from '@/shared/components/ui/label';
import { Textarea } from '@/shared/components/ui/textarea';
import { useValidationMessage } from '@/shared/hooks/useValidationMessage';

import { REVIEW_REPLY_MAX_LENGTH, replyReviewSchema } from '../schemas/review.schema';
import type { ReplyReviewInput } from '../types';

interface ReviewReplyFormProps {
  // Câu trả lời hiện có khi sửa lại; chuỗi rỗng khi trả lời lần đầu.
  initialReply: string;
  isPending: boolean;
  // Lỗi của lần gửi trước (đã dịch), hiện ngay trong form để shop thấy mà không phải tìm ở đầu trang.
  errorMessage: string | null;
  onSubmit: (reply: string) => void;
  onCancel: () => void;
}

// Form trả lời đánh giá của shop (component THUẦN, mutation ở nơi gọi): một ô nhập bắt buộc, tối đa
// REVIEW_REPLY_MAX_LENGTH ký tự (dùng đúng schema BE nên hai phía không lệch giới hạn), kèm bộ đếm. Câu trả lời
// hiện công khai trên trang sản phẩm; chỉ sửa lại được, không xoá — nói rõ ở dòng gợi ý để shop cân nhắc trước khi
// gửi. Form chỉ mount khi mở (mỗi lần mở là một form mới với câu trả lời hiện có), nên `defaultValues` đủ dùng.
export function ReviewReplyForm({
  initialReply,
  isPending,
  errorMessage,
  onSubmit,
  onCancel,
}: ReviewReplyFormProps) {
  const t = useTranslations('review');
  const tCommon = useTranslations('common');
  const translateValidation = useValidationMessage();
  const fieldId = useId();
  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<ReplyReviewInput>({
    resolver: zodResolver(replyReviewSchema),
    defaultValues: { reply: initialReply },
  });
  const reply = useWatch({ control, name: 'reply' });
  const isEdit = initialReply !== '';

  return (
    <form
      onSubmit={handleSubmit((values) => onSubmit(values.reply))}
      noValidate
      className="grid grid-cols-1 gap-2"
    >
      <Label htmlFor={fieldId}>{t('replyFormLabel')}</Label>
      <Textarea
        id={fieldId}
        aria-invalid={errors.reply ? true : undefined}
        aria-describedby={errors.reply ? `${fieldId}-error` : `${fieldId}-hint`}
        {...register('reply')}
      />
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        {errors.reply ? (
          <p id={`${fieldId}-error`} role="alert" className="min-w-0 text-sm text-destructive">
            {translateValidation(errors.reply.message)}
          </p>
        ) : (
          <p id={`${fieldId}-hint`} className="min-w-0 text-xs text-muted-foreground">
            {t('replyFormHint')}
          </p>
        )}
        <p className="shrink-0 text-xs text-muted-foreground tabular-nums">
          {t('formCommentCounter', { count: reply.length, max: REVIEW_REPLY_MAX_LENGTH })}
        </p>
      </div>

      {errorMessage ? (
        <p role="alert" className="text-sm break-words text-destructive">
          {errorMessage}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" className="min-h-9" disabled={isPending}>
          {isPending ? t('formSubmitting') : isEdit ? t('replySubmitEdit') : t('replySubmitCreate')}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="min-h-9"
          disabled={isPending}
          onClick={onCancel}
        >
          {tCommon('cancel')}
        </Button>
      </div>
    </form>
  );
}
