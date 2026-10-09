'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { useId } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';

import { StarRatingInput } from '@/shared/components/StarRatingInput';
import { Alert } from '@/shared/components/ui/alert';
import { Button } from '@/shared/components/ui/button';
import { Label } from '@/shared/components/ui/label';
import { Textarea } from '@/shared/components/ui/textarea';
import { useValidationMessage } from '@/shared/hooks/useValidationMessage';
import { cn } from '@/shared/lib/utils';

import { REVIEW_COMMENT_MAX_LENGTH, reviewFormSchema } from '../schemas/review.schema';
import type { ReviewFormInput } from '../types';

interface ReviewFormProps {
  mode: 'create' | 'edit';
  // Đánh giá cũ khi sửa. Có thể tới BẤT ĐỒNG BỘ (chi tiết đơn đang tải/làm mới) nên đưa vào option `values`
  // của react-hook-form, không phải `defaultValues` — `defaultValues` chỉ đọc đúng một lần lúc khởi tạo
  // (rules/frontend.md mục 4). Khi viết mới thì bỏ trống.
  initialValues?: ReviewFormInput;
  isSubmitting: boolean;
  // Lỗi từ API đã dịch sẵn (vd REVIEW_NOT_ALLOWED) — hiện ở đầu form. Lỗi validate từng ô hiện ở chính ô đó.
  errorMessage?: string | null;
  onSubmit: (values: ReviewFormInput) => void;
  onCancel: () => void;
}

// Form viết/sửa đánh giá: số sao BẮT BUỘC (StarRatingInput), nhận xét tuỳ chọn tối đa 1000 ký tự kèm bộ đếm.
// Component thuần — không gọi API: nơi dùng (Container ở module order) nối mutation và truyền
// `isSubmitting`/`errorMessage`. Nút gửi `disabled` khi đang gửi. Schema dùng chung với BE (`reviewFormSchema`)
// nên giới hạn không lệch; `onSubmit` nhận giá trị đã trim, nhận xét bỏ trống thành `undefined`.
export function ReviewForm({
  mode,
  initialValues,
  isSubmitting,
  errorMessage,
  onSubmit,
  onCancel,
}: ReviewFormProps) {
  const t = useTranslations('review');
  const tCommon = useTranslations('common');
  const translateValidation = useValidationMessage();
  const ids = useId();
  const ratingErrorId = `${ids}-rating-error`;
  const commentId = `${ids}-comment`;
  const commentErrorId = `${commentId}-error`;
  const commentCounterId = `${commentId}-counter`;

  const {
    control,
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ReviewFormInput>({
    resolver: zodResolver(reviewFormSchema),
    defaultValues: { comment: '' },
    values: initialValues,
  });

  // useWatch (không phải watch()): tương thích React Compiler, chỉ render lại khi riêng ô này đổi.
  const comment = useWatch({ control, name: 'comment' });
  const commentLength = comment?.length ?? 0;
  const isOverLimit = commentLength > REVIEW_COMMENT_MAX_LENGTH;

  return (
    <form
      noValidate
      onSubmit={handleSubmit((values) => onSubmit(values))}
      className="flex flex-col gap-4"
    >
      {errorMessage ? <Alert variant="destructive">{errorMessage}</Alert> : null}

      <div className="flex flex-col gap-1.5">
        <span className="text-sm leading-none font-medium text-foreground">
          {t('formRatingLabel')}
        </span>
        <Controller
          control={control}
          name="rating"
          render={({ field }) => (
            <StarRatingInput
              value={field.value}
              onChange={field.onChange}
              onBlur={field.onBlur}
              name={field.name}
              label={t('formRatingLabel')}
              disabled={isSubmitting}
              invalid={Boolean(errors.rating)}
              describedBy={errors.rating ? ratingErrorId : undefined}
              className="-ml-2"
            />
          )}
        />
        {errors.rating ? (
          <p id={ratingErrorId} role="alert" className="text-sm text-destructive">
            {translateValidation(errors.rating.message)}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={commentId}>{t('formCommentLabel')}</Label>
        <Textarea
          id={commentId}
          rows={4}
          placeholder={t('formCommentPlaceholder')}
          disabled={isSubmitting}
          aria-invalid={errors.comment ? true : undefined}
          aria-describedby={
            errors.comment ? `${commentErrorId} ${commentCounterId}` : commentCounterId
          }
          {...register('comment')}
        />
        <div className="flex items-start justify-between gap-3">
          {errors.comment ? (
            <p id={commentErrorId} role="alert" className="min-w-0 text-sm text-destructive">
              {translateValidation(errors.comment.message)}
            </p>
          ) : (
            <span />
          )}
          {/* Bộ đếm theo độ dài đang gõ; vượt giới hạn thì đổi sang màu báo lỗi (không chặn gõ/dán — lỗi
              hiện rõ ở ô và lúc gửi, tránh cắt cụt âm thầm đoạn người dùng dán vào). */}
          <span
            id={commentCounterId}
            className={cn(
              'shrink-0 text-xs tabular-nums',
              isOverLimit ? 'text-destructive' : 'text-muted-foreground',
            )}
          >
            {t('formCommentCounter', { count: commentLength, max: REVIEW_COMMENT_MAX_LENGTH })}
          </span>
        </div>
      </div>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" disabled={isSubmitting} onClick={onCancel}>
          {tCommon('cancel')}
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting
            ? t('formSubmitting')
            : mode === 'edit'
              ? t('formSubmitEdit')
              : t('formSubmitCreate')}
        </Button>
      </div>
    </form>
  );
}
