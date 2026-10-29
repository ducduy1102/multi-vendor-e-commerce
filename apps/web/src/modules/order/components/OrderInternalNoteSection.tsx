'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { LoaderCircle, TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId } from 'react';
import { useForm, useWatch } from 'react-hook-form';

import { Button } from '@/shared/components/ui/button';
import { Label } from '@/shared/components/ui/label';
import { Textarea } from '@/shared/components/ui/textarea';
import { useValidationMessage } from '@/shared/hooks/useValidationMessage';
import { cn } from '@/shared/lib/utils';

import {
  ORDER_INTERNAL_NOTE_MAX_LENGTH,
  orderInternalNoteFormSchema,
  type OrderInternalNoteFormInput,
} from '../schemas/order.schema';
import { DetailSection } from './OrderDetailSections';

interface OrderInternalNoteSectionProps {
  // Ghi chú hiện đang lưu (null = chưa có). Đổi (sau khi lưu hoặc tải lại) thì ô nhập được đặt lại theo giá trị mới — dữ liệu tới BẤT
  // ĐỒNG BỘ nên dùng `values` của useForm chứ không phải `defaultValues` (rules/frontend.md mục 4). Chữ người dùng đang gõ dở (đã
  // sửa) được giữ lại khi giá trị lưu đổi do một lần làm mới.
  note: string | null;
  isSaving: boolean;
  // Lần lưu gần nhất đã thành công — hiện "Đã lưu" cho tới khi người dùng sửa tiếp.
  isSaved: boolean;
  // Lỗi (đã dịch) của lần lưu gần nhất; null khi chưa có.
  error: string | null;
  // Chuỗi rỗng = xoá ghi chú. Trả về ghi chú ĐÃ LƯU theo bản BE chuẩn hoá ('' khi đã xoá) hoặc null khi lưu lỗi. Form đặt lại theo giá
  // trị trả về để nhận đúng bản BE đã chuẩn hoá (cắt khoảng trắng, xuống dòng LF) và hết "đã sửa"; lưu lỗi (null) thì GIỮ nguyên chữ
  // đang gõ. Không dựa vào việc `note` đổi theo cache: `keepDirtyValues` giữ chữ đang gõ dở nên sẽ không nhận bản chuẩn hoá.
  onSave: (note: string) => Promise<string | null>;
}

// Khối "Ghi chú nội bộ" ở chi tiết đơn của Seller (Week11.md 4.4): chỗ shop tự nhắc mình về đơn, người mua không bao giờ thấy. LƯU
// BẰNG NÚT, không tự lưu (rules của kế hoạch): mỗi lần lưu là một lần gọi API và ghi đè hẳn ghi chú cũ, tự lưu theo từng phím gõ sẽ vừa
// tốn request vừa dễ ghi đè nhầm. Nút chỉ bật khi nội dung khác bản đã lưu. Lưu lỗi giữ nguyên chữ đã gõ. Component THUẦN: mutation
// và dịch lỗi do Container nối.
export function OrderInternalNoteSection({
  note,
  isSaving,
  isSaved,
  error,
  onSave,
}: OrderInternalNoteSectionProps) {
  const t = useTranslations('order');
  const translateValidation = useValidationMessage();
  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors, isDirty },
  } = useForm<OrderInternalNoteFormInput>({
    resolver: zodResolver(orderInternalNoteFormSchema),
    values: { note: note ?? '' },
    resetOptions: { keepDirtyValues: true },
  });
  const length = (useWatch({ control, name: 'note' }) ?? '').length;
  const isTooLong = length > ORDER_INTERNAL_NOTE_MAX_LENGTH;
  const fieldId = useId();
  const hasFieldError = Boolean(errors.note);

  return (
    <DetailSection title={t('internalNoteTitle')}>
      <form
        onSubmit={handleSubmit(async (values) => {
          const saved = await onSave(values.note);
          // `useForm` gộp `resetOptions` (keepDirtyValues) vào MỌI lệnh reset thủ công: không ghi đè tường minh thì chữ đang gõ
          // (còn khoảng trắng thừa) được GIỮ và form không bao giờ nhận bản BE đã chuẩn hoá.
          if (saved !== null) reset({ note: saved }, { keepDirtyValues: false });
        })}
        noValidate
        className="flex flex-col gap-2"
      >
        <p className="text-xs text-muted-foreground">{t('internalNoteHint')}</p>
        <Label htmlFor={fieldId} className="sr-only">
          {t('internalNoteLabel')}
        </Label>
        <Textarea
          id={fieldId}
          rows={3}
          disabled={isSaving}
          placeholder={t('internalNotePlaceholder')}
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
            {t('internalNoteCounter', { count: length, max: ORDER_INTERNAL_NOTE_MAX_LENGTH })}
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
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={isSaving || !isDirty} aria-busy={isSaving || undefined}>
            {isSaving ? (
              <LoaderCircle
                aria-hidden="true"
                data-icon="inline-start"
                className="animate-spin motion-reduce:animate-none"
              />
            ) : null}
            {isSaving ? t('internalNoteSaving') : t('internalNoteSave')}
          </Button>
          {/* Luôn có mặt trong DOM (chỉ đổi chữ) để trình đọc màn hình đọc được thay đổi của vùng role="status". */}
          <span role="status" className="text-sm text-muted-foreground">
            {isSaved && !isDirty && !isSaving ? t('internalNoteSaved') : ''}
          </span>
        </div>
      </form>
    </DetailSection>
  );
}
