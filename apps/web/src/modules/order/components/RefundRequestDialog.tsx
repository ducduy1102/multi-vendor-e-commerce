'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { useId } from 'react';
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
import { useValidationMessage, type LooseTranslator } from '@/shared/hooks/useValidationMessage';

import { REFUND_REASON_CODES_BY_KIND, createRefundRequestSchema } from '../schemas/order.schema';
import { getRefundReasonLabelKey } from '../refund-request-display';
import type { CreateRefundRequestInput, RefundRequestKind } from '../types';

// Native <select> (không thêm primitive Select của shadcn — chưa được duyệt, cùng quyết định đã chốt ở
// AddressForm/VoucherForm/ProductFilterBar), style khớp Input để đồng bộ giao diện và focus-visible.
const SELECT_CLASS =
  'h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive md:text-sm dark:bg-input/30';

interface RefundRequestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Loại yêu cầu do BE suy ra từ trạng thái đơn (CONFIRMED/PACKED ⇒ CANCEL, COMPLETED ⇒ RETURN); FE chỉ dùng
  // để chọn tập lý do + câu giải thích — KHÔNG gửi lên BE.
  kind: RefundRequestKind;
  isPending: boolean;
  onConfirm: (values: CreateRefundRequestInput) => void;
}

interface RefundRequestFormProps {
  kind: RefundRequestKind;
  isPending: boolean;
  onConfirm: (values: CreateRefundRequestInput) => void;
}

// Form nằm trong component riêng vì chỉ được mount khi hộp thoại mở: mỗi lần mở là 1 form mới (không giữ lại lý
// do của lần gửi trước). Nút gửi KHÔNG phải AlertDialogAction — action đó tự đóng hộp thoại ngay khi bấm, còn ở
// đây phải giữ hộp thoại mở (nút khoá) tới khi yêu cầu xong, giống CancelOrderDialog.
function RefundRequestForm({ kind, isPending, onConfirm }: RefundRequestFormProps) {
  const t = useTranslations('order');
  const tDynamic = t as unknown as LooseTranslator;
  const translateValidation = useValidationMessage();
  const ids = useId();
  const reasonId = `${ids}-reason`;
  const noteId = `${ids}-note`;
  const reasonErrorId = `${reasonId}-error`;
  const noteErrorId = `${noteId}-error`;

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<CreateRefundRequestInput>({
    resolver: zodResolver(createRefundRequestSchema),
    defaultValues: { reasonNote: '' },
  });

  return (
    <>
      <AlertDialogHeader>
        <AlertDialogTitle>
          {kind === 'CANCEL' ? t('refundDialogTitleCancel') : t('refundDialogTitleReturn')}
        </AlertDialogTitle>
        <AlertDialogDescription>
          {kind === 'CANCEL'
            ? t('refundDialogDescriptionCancel')
            : t('refundDialogDescriptionReturn')}
        </AlertDialogDescription>
      </AlertDialogHeader>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={reasonId}>{t('refundReasonLabel')}</Label>
        {/* `""` của ô chưa chọn đổi thành `undefined` để báo đúng "Vui lòng chọn lý do" (thiếu) thay vì "Lý do
            không hợp lệ" (sai giá trị) của schema. */}
        <select
          id={reasonId}
          className={SELECT_CLASS}
          defaultValue=""
          disabled={isPending}
          aria-invalid={errors.reasonCode ? true : undefined}
          aria-describedby={errors.reasonCode ? reasonErrorId : undefined}
          {...register('reasonCode', { setValueAs: (value: string) => value || undefined })}
        >
          <option value="">{t('refundReasonPlaceholder')}</option>
          {REFUND_REASON_CODES_BY_KIND[kind].map((code) => (
            <option key={code} value={code}>
              {tDynamic(getRefundReasonLabelKey(code))}
            </option>
          ))}
        </select>
        {errors.reasonCode ? (
          <p id={reasonErrorId} role="alert" className="text-sm text-destructive">
            {translateValidation(errors.reasonCode.message)}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={noteId}>{t('refundNoteLabel')}</Label>
        <Textarea
          id={noteId}
          rows={3}
          disabled={isPending}
          aria-invalid={errors.reasonNote ? true : undefined}
          aria-describedby={errors.reasonNote ? `${noteErrorId}` : undefined}
          {...register('reasonNote')}
        />
        {errors.reasonNote ? (
          <p id={noteErrorId} role="alert" className="text-sm break-words text-destructive">
            {translateValidation(errors.reasonNote.message)}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">{t('refundNoteHint')}</p>
        )}
      </div>

      <AlertDialogFooter>
        <AlertDialogCancel disabled={isPending}>{t('dialogBack')}</AlertDialogCancel>
        <Button
          type="button"
          disabled={isPending}
          onClick={handleSubmit((values) => onConfirm(values))}
        >
          {t('refundDialogConfirm')}
        </Button>
      </AlertDialogFooter>
    </>
  );
}

// Hộp thoại gửi yêu cầu hủy (đơn đã được shop xác nhận/đóng gói) hoặc trả hàng/hoàn tiền (đơn đã hoàn tất, còn
// trong cửa sổ hoàn trả). Lý do chọn từ danh sách theo loại yêu cầu (`REFUND_REASON_CODES_BY_KIND`), mô tả
// bắt buộc khi chọn "Lý do khác" (schema dùng chung với BE). Nút gửi trung tính (không đỏ): đây là gửi yêu cầu
// để shop xem xét, chưa phải hành động phá huỷ.
export function RefundRequestDialog({
  open,
  onOpenChange,
  kind,
  isPending,
  onConfirm,
}: RefundRequestDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      {/* `grid-cols-1` (= minmax(0, 1fr)): hộp thoại là `grid` nên cột ngầm định `auto` lấy min-content của
          `<textarea>` (field-sizing: content) — 500 ký tự liền không dấu cách làm nội dung rộng ~4400px,
          tràn khỏi hộp thoại ở 390px (rules/frontend.md mục 5). jsdom không có layout nên chỉ giữ được lớp class. */}
      <AlertDialogContent className="grid-cols-1">
        <RefundRequestForm kind={kind} isPending={isPending} onConfirm={onConfirm} />
      </AlertDialogContent>
    </AlertDialog>
  );
}
