'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { ADMIN_CANCEL_SHOP_ORDERS_BATCH_SIZE, isErrorCode } from '@ecommerce/types';
import { Boxes, LoaderCircle, Mail, Ticket, TriangleAlert, Undo2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useMemo } from 'react';
import { useForm, useWatch } from 'react-hook-form';

import { Link } from '@/i18n/navigation';
import { formatPrice } from '@/modules/product';
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
import { Input } from '@/shared/components/ui/input';
import { Label } from '@/shared/components/ui/label';
import { Textarea } from '@/shared/components/ui/textarea';
import { useValidationMessage, type LooseTranslator } from '@/shared/hooks/useValidationMessage';
import { ERROR_CODE_MESSAGE_KEYS } from '@/shared/lib/error-codes';
import { cn } from '@/shared/lib/utils';

import { shortOrderId, type CancelShopOrdersSummary } from '../admin-cancel-orders-result';
import { buildAdminRefundsHref } from '../admin-refunds-href';
import type { CancelShopOrdersDialogState } from '../hooks/useCancelShopOrdersFlow';
import {
  ADMIN_USER_REASON_MAX_LENGTH,
  createCancelShopOrdersFormSchema,
  type CancelShopOrdersFormInput,
} from '../schemas/admin.schema';
import { AdminConsequenceItem } from './AdminConsequenceItem';

function ErrorBlock({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm"
    >
      <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-destructive" />
      <p className="text-foreground [overflow-wrap:anywhere]">{message}</p>
    </div>
  );
}

interface CancelOrdersFormProps {
  shopName: string;
  isPending: boolean;
  error: string | null;
  onConfirm: (reason: string) => void;
}

// Form chỉ mount khi hộp thoại mở (mỗi lần mở là một form trống). Nút xác nhận KHÔNG phải AlertDialogAction — action đó tự
// đóng ngay khi bấm, còn ở đây phải giữ hộp thoại mở (và khoá) tới khi yêu cầu xong rồi chuyển sang màn kết quả.
function CancelOrdersForm({ shopName, isPending, error, onConfirm }: CancelOrdersFormProps) {
  const t = useTranslations('admin');
  const translateValidation = useValidationMessage();
  const schema = useMemo(() => createCancelShopOrdersFormSchema(shopName), [shopName]);
  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<CancelShopOrdersFormInput>({
    resolver: zodResolver(schema),
    defaultValues: { reason: '', confirmName: '' },
  });
  const reasonLength = (useWatch({ control, name: 'reason' }) ?? '').length;
  const baseId = useId();
  const reasonId = `${baseId}-reason`;
  const nameId = `${baseId}-name`;

  return (
    <form
      onSubmit={handleSubmit((values) => onConfirm(values.reason))}
      noValidate
      className="flex flex-col gap-4"
    >
      <AlertDialogHeader className="place-items-start text-left">
        <AlertDialogTitle>{t('cancelOrdersTitle')}</AlertDialogTitle>
        <AlertDialogDescription className="[overflow-wrap:anywhere]">
          {t('cancelOrdersDescription', { name: shopName })}
        </AlertDialogDescription>
      </AlertDialogHeader>

      <ul
        aria-label={t('cancelOrdersConsequencesLabel')}
        className="flex flex-col gap-2 rounded-lg border border-border bg-muted/40 p-3"
      >
        <AdminConsequenceItem Icon={Boxes}>
          {t('cancelOrdersConsequenceStock')}
        </AdminConsequenceItem>
        <AdminConsequenceItem Icon={Ticket}>
          {t('cancelOrdersConsequenceVoucher')}
        </AdminConsequenceItem>
        <AdminConsequenceItem Icon={Undo2}>
          {t('cancelOrdersConsequenceRefund')}
        </AdminConsequenceItem>
        <AdminConsequenceItem Icon={Mail}>{t('cancelOrdersConsequenceEmail')}</AdminConsequenceItem>
        <AdminConsequenceItem Icon={TriangleAlert}>
          {/* Số đơn mỗi lần gọi chỉ để NÓI cho Admin biết; con số thật do BE giữ (cùng hằng ở packages/types). */}
          {t('cancelOrdersConsequenceIrreversible', { max: ADMIN_CANCEL_SHOP_ORDERS_BATCH_SIZE })}
        </AdminConsequenceItem>
      </ul>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={reasonId}>
          {t('cancelOrdersReasonLabel')}{' '}
          <span className="font-normal text-muted-foreground">{t('usersReasonHint')}</span>
        </Label>
        <Textarea
          id={reasonId}
          rows={3}
          disabled={isPending}
          aria-invalid={errors.reason ? true : undefined}
          aria-describedby={errors.reason ? `${reasonId}-error` : undefined}
          {...register('reason')}
        />
        <div className="flex items-start justify-between gap-3">
          {errors.reason ? (
            <p id={`${reasonId}-error`} role="alert" className="text-sm text-destructive">
              {translateValidation(errors.reason.message)}
            </p>
          ) : (
            <span />
          )}
          <span
            className={cn(
              'shrink-0 text-xs tabular-nums',
              reasonLength > ADMIN_USER_REASON_MAX_LENGTH
                ? 'text-destructive'
                : 'text-muted-foreground',
            )}
          >
            {t('usersReasonCounter', { count: reasonLength, max: ADMIN_USER_REASON_MAX_LENGTH })}
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={nameId}>{t('cancelOrdersConfirmNameLabel')}</Label>
        <p id={`${nameId}-hint`} className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
          {t('cancelOrdersConfirmNameHint', { name: shopName })}
        </p>
        <Input
          id={nameId}
          autoComplete="off"
          spellCheck={false}
          disabled={isPending}
          aria-invalid={errors.confirmName ? true : undefined}
          aria-describedby={`${nameId}-hint${errors.confirmName ? ` ${nameId}-error` : ''}`}
          {...register('confirmName')}
        />
        {errors.confirmName ? (
          <p id={`${nameId}-error`} role="alert" className="text-sm text-destructive">
            {translateValidation(errors.confirmName.message)}
          </p>
        ) : null}
      </div>

      {error ? <ErrorBlock message={error} /> : null}

      <AlertDialogFooter>
        <AlertDialogCancel disabled={isPending}>{t('dialogBack')}</AlertDialogCancel>
        <Button
          type="submit"
          variant="destructive"
          disabled={isPending}
          aria-busy={isPending || undefined}
        >
          {isPending ? (
            <LoaderCircle
              aria-hidden="true"
              data-icon="inline-start"
              className="animate-spin motion-reduce:animate-none"
            />
          ) : null}
          {isPending ? t('cancelOrdersPending') : t('cancelOrdersConfirm')}
        </Button>
      </AlertDialogFooter>
    </form>
  );
}

interface CancelOrdersResultProps {
  summary: CancelShopOrdersSummary;
  isPending: boolean;
  error: string | null;
  onContinue: () => void;
}

// Kết quả của phiên hủy: số đơn đã hủy, còn lại bao nhiêu (kèm nút chạy tiếp), đơn lỗi theo mã đã dịch, đơn đã hủy nhưng cổng
// từ chối hoàn tiền (kèm lối sang màn hoàn tiền), khoản hoàn còn chờ cổng. Mã đơn là 8 ký tự đầu của id, khớp các màn đơn hàng.
function CancelOrdersResult({ summary, isPending, error, onContinue }: CancelOrdersResultProps) {
  const t = useTranslations('admin');
  const tCommon = useTranslations('common');
  const tGlobal = useTranslations() as unknown as LooseTranslator;
  const nothingToDo =
    summary.cancelled === 0 &&
    summary.remaining === 0 &&
    summary.failed.length === 0 &&
    summary.needsManualRefund.length === 0;

  return (
    <div className="flex flex-col gap-4">
      <AlertDialogHeader className="place-items-start text-left">
        <AlertDialogTitle>{t('cancelOrdersResultTitle')}</AlertDialogTitle>
        <AlertDialogDescription role="status" className="[overflow-wrap:anywhere]">
          {nothingToDo
            ? t('cancelOrdersResultNone')
            : t('cancelOrdersResultCancelled', { count: summary.cancelled })}
          {summary.remaining > 0
            ? ` ${t('cancelOrdersResultRemaining', { count: summary.remaining })}`
            : ''}
        </AlertDialogDescription>
      </AlertDialogHeader>

      {summary.failed.length > 0 ? (
        <section
          aria-label={t('cancelOrdersResultFailedTitle', { count: summary.failed.length })}
          className="flex flex-col gap-1.5"
        >
          <h3 className="text-sm font-medium text-foreground">
            {t('cancelOrdersResultFailedTitle', { count: summary.failed.length })}
          </h3>
          <ul className="flex flex-col gap-1 rounded-lg border border-border bg-muted/40 p-3 text-sm">
            {summary.failed.map((item) => (
              <li key={item.orderId} className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-mono text-xs text-muted-foreground">
                  {shortOrderId(item.orderId)}
                </span>
                <span className="text-foreground/90">
                  {isErrorCode(item.code)
                    ? tGlobal(ERROR_CODE_MESSAGE_KEYS[item.code])
                    : t('cancelOrdersFailureUnknown')}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {summary.needsManualRefund.length > 0 ? (
        <section
          aria-label={t('cancelOrdersResultManualTitle', {
            count: summary.needsManualRefund.length,
          })}
          className="flex flex-col gap-1.5"
        >
          <h3 className="text-sm font-medium text-foreground">
            {t('cancelOrdersResultManualTitle', { count: summary.needsManualRefund.length })}
          </h3>
          <p className="text-sm text-muted-foreground">{t('cancelOrdersResultManualHint')}</p>
          <ul className="flex flex-col gap-1 rounded-lg border border-border bg-muted/40 p-3 text-sm">
            {summary.needsManualRefund.map((item) => (
              <li
                key={item.refundId}
                className="flex flex-wrap items-baseline justify-between gap-x-2"
              >
                <span className="font-mono text-xs text-muted-foreground">
                  {shortOrderId(item.orderId)}
                </span>
                <span className="font-medium text-foreground tabular-nums">
                  {formatPrice(item.amount)}
                </span>
              </li>
            ))}
          </ul>
          <Link
            href={buildAdminRefundsHref({ tab: 'failed' })}
            className="w-fit rounded-sm text-sm text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            {t('cancelOrdersOpenRefunds')}
          </Link>
        </section>
      ) : null}

      {summary.refundsPending > 0 ? (
        <p className="text-sm text-muted-foreground">
          {t('cancelOrdersResultPending', { count: summary.refundsPending })}
        </p>
      ) : null}

      {error ? <ErrorBlock message={error} /> : null}

      <AlertDialogFooter>
        <AlertDialogCancel disabled={isPending}>{tCommon('close')}</AlertDialogCancel>
        {summary.remaining > 0 ? (
          <Button
            type="button"
            variant="destructive"
            disabled={isPending}
            aria-busy={isPending || undefined}
            onClick={onContinue}
          >
            {isPending ? (
              <LoaderCircle
                aria-hidden="true"
                data-icon="inline-start"
                className="animate-spin motion-reduce:animate-none"
              />
            ) : null}
            {isPending
              ? t('cancelOrdersPending')
              : t('cancelOrdersContinue', { count: summary.remaining })}
          </Button>
        ) : null}
      </AlertDialogFooter>
    </div>
  );
}

// Hủy HÀNG LOẠT đơn chưa giao của shop đang bị khoá (Week11.md 4.1): không hoàn tác được và động tới nhiều người mua cùng lúc nên
// nằm sau xác nhận nặng — liệt kê hậu quả, lý do bắt buộc (người mua đọc được) và PHẢI gõ lại đúng tên shop. Xong thì hộp thoại
// chuyển sang màn kết quả ngay tại chỗ (không đóng), kèm nút chạy tiếp khi shop còn đơn. Component THUẦN trình bày; mutation,
// trạng thái, dịch lỗi nằm ở useCancelShopOrdersFlow.
export function CancelShopOrdersDialog({
  target,
  isOpen,
  onOpenChange,
  isPending,
  error,
  summary,
  onConfirm,
  onContinue,
}: CancelShopOrdersDialogState) {
  if (!target) return null;

  return (
    <AlertDialog open={isOpen} onOpenChange={onOpenChange}>
      {/* Hộp thoại dài (hậu quả + hai ô nhập + nút): giới hạn theo chiều cao khung nhìn và tự cuộn, nếu không ở điện thoại / màn thấp
          nút xác nhận nằm NGOÀI màn hình và không thể bấm tới (đã đo ở 390x844). */}
      <AlertDialogContent className="data-[size=default]:sm:max-w-md max-h-[calc(100dvh-2rem)] overflow-y-auto">
        {summary ? (
          <CancelOrdersResult
            summary={summary}
            isPending={isPending}
            error={error}
            onContinue={onContinue}
          />
        ) : (
          <CancelOrdersForm
            shopName={target.name}
            isPending={isPending}
            error={error}
            onConfirm={onConfirm}
          />
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
}
