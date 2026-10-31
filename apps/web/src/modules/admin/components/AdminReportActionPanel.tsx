'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Eye } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId } from 'react';
import { useForm, useWatch } from 'react-hook-form';

import { Button } from '@/shared/components/ui/button';
import { Label } from '@/shared/components/ui/label';
import { Textarea } from '@/shared/components/ui/textarea';
import { useValidationMessage, type LooseTranslator } from '@/shared/hooks/useValidationMessage';
import { cn } from '@/shared/lib/utils';

import { ADMIN_REPORT_ACTION_COPY, availableAdminReportActions } from '../admin-report-display';
import { REPORT_RESOLUTION_NOTE_MAX_LENGTH, resolveReportSchema } from '../schemas/admin.schema';
import type { AdminReport, ResolveReportInput } from '../types';
import { ADMIN_CAUTION_BUTTON_CLASS } from './admin-caution-button.constants';

interface AdminReportActionPanelProps {
  report: AdminReport;
  isPending: boolean;
  // Lựa chọn đã qua schema (ghi chú bắt buộc trừ "Bỏ qua"). Nơi gọi mở hộp thoại xác nhận — panel không gọi API.
  onRequest: (input: ResolveReportInput) => void;
}

// Panel Xử lý của trang chi tiết (phương án A của wireframe, dính khi cuộn ở `xl`). Chỉ hiện CÁC HÀNH ĐỘNG DÙNG ĐƯỢC cho loại báo cáo này
// và đã có bộ xử lý ở BE (availableAdminReportActions). Ghi chú là nơi dễ nhầm nhất: với ẩn đánh giá / khoá shop nó HIỆN cho bên bị xử lý nên
// dòng gợi ý nói rõ ai đọc và dặn không nêu người báo cáo; "Bỏ qua" không cần ghi chú. Hệ quả (đóng thêm N báo cáo) hiện ngay dưới ô nhập.
export function AdminReportActionPanel({
  report,
  isPending,
  onRequest,
}: AdminReportActionPanelProps) {
  const t = useTranslations('admin');
  const tDynamic = t as unknown as LooseTranslator;
  const translateValidation = useValidationMessage();
  const fieldId = useId();
  const actions = availableAdminReportActions(report);
  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<ResolveReportInput>({
    resolver: zodResolver(resolveReportSchema),
    defaultValues: { action: actions[0], note: '' },
  });
  const selected = useWatch({ control, name: 'action' });
  const noteLength = (useWatch({ control, name: 'note' }) ?? '').length;
  // `actions` luôn có "Bỏ qua" (hợp lệ ở mọi loại và đã có bộ xử lý ở BE — admin-report-display.test.ts khoá điều này) nên không bao giờ rỗng.
  const selectedAction = actions.find((action) => action === selected) ?? actions[0];
  const copy = ADMIN_REPORT_ACTION_COPY[selectedAction];
  const isNoteRequired = selectedAction !== 'DISMISS';
  const isNoteTooLong = noteLength > REPORT_RESOLUTION_NOTE_MAX_LENGTH;
  const hasNoteError = Boolean(errors.note);
  const others = report.sameTargetOpenCount;

  return (
    <section
      aria-labelledby={`${fieldId}-title`}
      className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4 xl:sticky xl:top-4"
    >
      <h2 id={`${fieldId}-title`} className="text-sm font-semibold">
        {t('reportActionPanelTitle')}
      </h2>

      <form onSubmit={handleSubmit(onRequest)} noValidate className="flex flex-col gap-4">
        <fieldset disabled={isPending} className="flex min-w-0 flex-col gap-2">
          <legend className="sr-only">{t('reportActionsLegend')}</legend>
          {actions.map((action) => {
            const actionCopy = ADMIN_REPORT_ACTION_COPY[action];
            const isOn = action === selected;
            return (
              <label
                key={action}
                className={cn(
                  'flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 text-sm has-focus-visible:ring-3 has-focus-visible:ring-ring/50 has-disabled:cursor-not-allowed has-disabled:opacity-60',
                  isOn ? 'border-primary bg-primary/5' : 'border-border',
                )}
              >
                <input
                  type="radio"
                  value={action}
                  className="mt-0.5 size-4 shrink-0 accent-primary"
                  {...register('action')}
                />
                <span className="min-w-0">
                  <span className="block font-medium">{tDynamic(actionCopy.labelKey)}</span>
                  <span
                    className={cn(
                      'block text-xs text-pretty',
                      isOn ? 'text-foreground/75' : 'text-muted-foreground',
                    )}
                  >
                    {tDynamic(actionCopy.descriptionKey)}
                  </span>
                </span>
              </label>
            );
          })}
        </fieldset>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${fieldId}-note`}>
            {isNoteRequired ? t('reportNoteLabel') : t('reportNoteLabelOptional')}
          </Label>
          <Textarea
            id={`${fieldId}-note`}
            rows={4}
            disabled={isPending}
            placeholder={t('reportNotePlaceholder')}
            aria-invalid={hasNoteError ? true : undefined}
            aria-describedby={hasNoteError ? `${fieldId}-note-error` : undefined}
            {...register('note')}
          />
          <div className="flex items-start justify-between gap-3">
            {errors.note ? (
              <p id={`${fieldId}-note-error`} role="alert" className="text-sm text-destructive">
                {translateValidation(errors.note.message)}
              </p>
            ) : copy.noteVisibilityKey ? (
              <p className="flex items-start gap-1.5 text-xs text-pretty text-muted-foreground">
                <Eye aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                {tDynamic(copy.noteVisibilityKey)}
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
              {t('notesCounter', { count: noteLength, max: REPORT_RESOLUTION_NOTE_MAX_LENGTH })}
            </span>
          </div>
        </div>

        <p className="text-sm text-muted-foreground">
          {others > 0 ? t('reportConsequence', { count: others }) : t('reportConsequenceNone')}
        </p>

        <Button
          type="submit"
          variant="outline"
          size="lg"
          disabled={isPending}
          className={cn('w-full', copy.isCautionary && ADMIN_CAUTION_BUTTON_CLASS)}
        >
          {tDynamic(copy.submitKey)}
        </Button>
      </form>
    </section>
  );
}
