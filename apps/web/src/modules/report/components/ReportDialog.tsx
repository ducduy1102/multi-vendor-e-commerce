'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { LoaderCircle, Send, TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';

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
import { useValidationMessage, type LooseTranslator } from '@/shared/hooks/useValidationMessage';
import { cn } from '@/shared/lib/utils';

import { REPORT_REASON_MESSAGE_KEYS } from '@/shared/lib/report-reason-labels';
import { REPORT_TARGET_TITLE_KEYS } from '../report-display';
import {
  createReportSchema,
  REPORT_NOTE_MAX_LENGTH,
  REPORT_REASON_CODES_BY_TARGET,
  type ReportFormInput,
} from '../schemas/report.schema';
import type { ReportReasonCode, ReportTargetType } from '../types';

interface ReportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targetType: ReportTargetType;
  targetId: string;
  isPending: boolean;
  // Lỗi (đã dịch) của lần gửi gần nhất; null khi chưa có.
  error: string | null;
  // Trả `true` khi báo cáo đã được gửi — nơi gọi tự đóng hộp thoại; gửi lỗi thì giữ nguyên lựa chọn và chữ vừa gõ.
  onSubmit: (input: ReportFormInput) => Promise<boolean>;
}

// Lý do là một nhóm nút radio gốc của trình duyệt (không thêm primitive Select/RadioGroup): chỉ 5–6 lựa chọn nên hiện hết, mỗi dòng
// cao tối thiểu 44px dễ bấm trên mobile, bàn phím mũi tên chọn được nhờ cùng `name`. `has-checked:` / `has-focus-visible:` tô viền
// dòng đang chọn / đang focus mà không cần state riêng.
const REASON_OPTION_CLASS =
  'flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-border px-3 py-2 text-sm text-foreground transition-colors has-checked:border-primary has-checked:bg-primary/5 has-focus-visible:ring-3 has-focus-visible:ring-ring/50 has-disabled:cursor-not-allowed has-disabled:opacity-60 motion-reduce:transition-none';

// Form chỉ mount khi hộp thoại mở (mỗi lần mở là một form trống). Nút gửi KHÔNG phải AlertDialogAction — action đó tự đóng ngay khi
// bấm, còn ở đây phải giữ hộp thoại mở (nút khoá) tới khi yêu cầu xong, và giữ lại lựa chọn / chữ đã gõ khi gửi lỗi.
function ReportForm({
  targetType,
  targetId,
  isPending,
  error,
  onSubmit,
}: Omit<ReportDialogProps, 'open' | 'onOpenChange'>) {
  const t = useTranslations('report');
  // Khoá dịch của lý do / tiêu đề chọn theo dữ liệu (mã lý do, loại đối tượng) nên đi qua bộ dịch lỏng; tập khoá được khoá chặt ở
  // report-display.ts + report-display.test.ts.
  const translate = t as unknown as LooseTranslator;
  const translateValidation = useValidationMessage();
  const fieldId = useId();
  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<ReportFormInput>({
    resolver: zodResolver(createReportSchema),
    defaultValues: { targetType, targetId, note: '' },
  });
  const reasonCode = useWatch({ control, name: 'reasonCode' });
  const noteLength = (useWatch({ control, name: 'note' }) ?? '').length;
  const isOther = reasonCode === 'OTHER';
  const isNoteTooLong = noteLength > REPORT_NOTE_MAX_LENGTH;
  const hasReasonError = Boolean(errors.reasonCode);
  const hasNoteError = Boolean(errors.note);
  const reasons: readonly ReportReasonCode[] = REPORT_REASON_CODES_BY_TARGET[targetType];

  return (
    <form
      onSubmit={handleSubmit(async (values) => {
        await onSubmit(values);
      })}
      noValidate
      className="flex flex-col gap-4"
    >
      <AlertDialogHeader>
        <AlertDialogTitle>{translate(REPORT_TARGET_TITLE_KEYS[targetType])}</AlertDialogTitle>
        <AlertDialogDescription>{t('description')}</AlertDialogDescription>
      </AlertDialogHeader>

      <Controller
        control={control}
        name="reasonCode"
        render={({ field }) => (
          <fieldset
            disabled={isPending}
            aria-describedby={hasReasonError ? `${fieldId}-reason-error` : undefined}
            className="flex min-w-0 flex-col gap-1.5"
          >
            <legend className="mb-1.5 text-sm font-medium text-foreground">
              {t('reasonLegend')}
            </legend>
            {reasons.map((code) => (
              <label key={code} className={REASON_OPTION_CLASS}>
                <input
                  type="radio"
                  name={field.name}
                  value={code}
                  checked={field.value === code}
                  onChange={() => field.onChange(code)}
                  onBlur={field.onBlur}
                  className="size-4 shrink-0 accent-primary"
                />
                <span className="min-w-0 [overflow-wrap:anywhere]">
                  {translate(REPORT_REASON_MESSAGE_KEYS[code])}
                </span>
              </label>
            ))}
          </fieldset>
        )}
      />
      {errors.reasonCode ? (
        <p id={`${fieldId}-reason-error`} role="alert" className="-mt-2 text-sm text-destructive">
          {translateValidation(errors.reasonCode.message)}
        </p>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${fieldId}-note`}>
          {isOther ? t('noteLabelRequired') : t('noteLabel')}
        </Label>
        <Textarea
          id={`${fieldId}-note`}
          rows={4}
          disabled={isPending}
          placeholder={t('notePlaceholder')}
          aria-invalid={hasNoteError ? true : undefined}
          aria-describedby={hasNoteError ? `${fieldId}-note-error` : undefined}
          {...register('note')}
        />
        <div className="flex items-start justify-between gap-3">
          {errors.note ? (
            <p id={`${fieldId}-note-error`} role="alert" className="text-sm text-destructive">
              {translateValidation(errors.note.message)}
            </p>
          ) : (
            <span />
          )}
          <span
            className={cn(
              'shrink-0 text-xs tabular-nums',
              isNoteTooLong ? 'text-destructive' : 'text-muted-foreground',
            )}
          >
            {t('counter', { count: noteLength, max: REPORT_NOTE_MAX_LENGTH })}
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

// Hộp thoại báo cáo vi phạm (Week11.md 5.6): chọn lý do (tập lý do theo LOẠI đối tượng, từ hợp đồng dùng chung), mô tả thêm (bắt buộc
// khi chọn "Khác"). Component THUẦN: mutation và dịch lỗi do `ReportButton` nối. Mô tả của người dùng chỉ đi vào ô nhập và request,
// không bao giờ được vẽ lại ở đây.
export function ReportDialog({
  open,
  onOpenChange,
  targetType,
  targetId,
  isPending,
  error,
  onSubmit,
}: ReportDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto data-[size=default]:sm:max-w-md">
        <ReportForm
          targetType={targetType}
          targetId={targetId}
          isPending={isPending}
          error={error}
          onSubmit={onSubmit}
        />
      </AlertDialogContent>
    </AlertDialog>
  );
}
