'use client';

import { useTranslations } from 'next-intl';

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
import type { LooseTranslator } from '@/shared/hooks/useValidationMessage';
import { cn } from '@/shared/lib/utils';

import { ADMIN_REPORT_ACTION_COPY, type AdminPluggedReportAction } from '../admin-report-display';
import type { ResolveReportInput } from '../types';
import { ADMIN_DESTRUCTIVE_CONFIRM_BUTTON_CLASS } from './admin-caution-button.constants';

interface AdminReportConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Lựa chọn Admin vừa gửi từ panel Xử lý (đã qua schema). `action` ở đây luôn là hành động đã cắm bộ xử lý (panel chỉ cho chọn những cái đó).
  input: ResolveReportInput;
  // Số báo cáo mở KHÁC về cùng đối tượng sẽ đóng cùng (sameTargetOpenCount của báo cáo đang xử lý).
  othersCount: number;
  isPending: boolean;
  onConfirm: () => void;
}

// Bước xác nhận cuối: nêu hệ quả bằng chữ (việc gì sẽ xảy ra với đối tượng, bao nhiêu báo cáo đóng cùng) và cho Admin đọc lại đúng ghi chú sắp
// gửi đi. Nút xác nhận của hành động huỷ bỏ là nút đỏ đặc (ADMIN_DESTRUCTIVE_CONFIRM_BUTTON_CLASS, rules/frontend.md mục 11); "Bỏ qua" giữ nút
// chính trung tính. Nút xác nhận KHÔNG phải AlertDialogAction (nó tự đóng ngay khi bấm) — hộp thoại giữ mở, nút khoá, tới khi yêu cầu xong.
export function AdminReportConfirmDialog({
  open,
  onOpenChange,
  input,
  othersCount,
  isPending,
  onConfirm,
}: AdminReportConfirmDialogProps) {
  const t = useTranslations('admin');
  const tDynamic = t as unknown as LooseTranslator;
  const copy = ADMIN_REPORT_ACTION_COPY[input.action as AdminPluggedReportAction];

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto data-[size=default]:sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>{tDynamic(copy.confirmTitleKey)}</AlertDialogTitle>
          <AlertDialogDescription>{tDynamic(copy.confirmDescriptionKey)}</AlertDialogDescription>
        </AlertDialogHeader>

        <div className="flex min-w-0 flex-col gap-1 rounded-lg bg-muted/40 p-3">
          <p className="text-xs text-muted-foreground">{t('reportConfirmNoteLabel')}</p>
          {input.note ? (
            <p className="text-sm whitespace-pre-line [overflow-wrap:anywhere]">{input.note}</p>
          ) : (
            <p className="text-sm text-muted-foreground">{t('reportConfirmNoteNone')}</p>
          )}
          {input.note && copy.noteVisibilityKey ? (
            <p className="text-xs text-pretty text-muted-foreground">
              {tDynamic(copy.noteVisibilityKey)}
            </p>
          ) : null}
        </div>

        <p className="text-sm text-muted-foreground">
          {othersCount > 0
            ? t('reportConsequence', { count: othersCount })
            : t('reportConsequenceNone')}
        </p>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>{t('dialogBack')}</AlertDialogCancel>
          <Button
            type="button"
            variant={copy.isCautionary ? 'destructive' : 'default'}
            className={cn(copy.isCautionary && ADMIN_DESTRUCTIVE_CONFIRM_BUTTON_CLASS)}
            disabled={isPending}
            aria-busy={isPending || undefined}
            onClick={onConfirm}
          >
            {tDynamic(copy.confirmKey)}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
