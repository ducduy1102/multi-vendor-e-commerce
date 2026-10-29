'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  Ban,
  LoaderCircle,
  LockOpen,
  Lock,
  LogIn,
  LogOut,
  Mail,
  Store,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
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

import type { AdminUserAction } from '../admin-user-actions';
import {
  ADMIN_USER_REASON_MAX_LENGTH,
  userReasonFormSchema,
  type UserReasonFormInput,
} from '../schemas/admin.schema';
import type { AdminUserActionTarget } from '../hooks/useAdminUserActionFlow';
import { ADMIN_DESTRUCTIVE_CONFIRM_BUTTON_CLASS } from './admin-caution-button.constants';
import { AdminConsequenceItem } from './AdminConsequenceItem';

// Chữ + hậu quả của từng hành động. Câu nói về shop CỐ Ý chung chung ("nếu có"): hộp thoại mở từ danh sách không tải thêm chi
// tiết chỉ để biết người này có shop hay không (số shop chính xác nằm ở ngăn chi tiết). Gỡ cấm là câu duy nhất nói NGƯỢC lại với
// trực giác: shop KHÔNG tự mở lại, phải mở riêng ở trang Shop sau khi xem xét.
const COPY = {
  suspend: {
    titleKey: 'usersDialogSuspendTitle',
    introKey: 'usersDialogSuspendIntro',
    confirmKey: 'usersDialogSuspendConfirm',
    placeholderKey: 'usersReasonPlaceholderLock',
    isLocking: true,
    shopKey: 'usersConsequenceShopsSuspend',
    ConfirmIcon: Lock,
    confirmVariant: 'destructive',
  },
  ban: {
    titleKey: 'usersDialogBanTitle',
    introKey: 'usersDialogBanIntro',
    confirmKey: 'usersDialogBanConfirm',
    placeholderKey: 'usersReasonPlaceholderLock',
    isLocking: true,
    shopKey: 'usersConsequenceShopsBan',
    ConfirmIcon: Ban,
    confirmVariant: 'destructive',
  },
  reactivate: {
    titleKey: 'usersDialogReactivateTitle',
    introKey: 'usersDialogReactivateIntro',
    confirmKey: 'usersDialogReactivateConfirm',
    placeholderKey: 'usersReasonPlaceholderUnlock',
    isLocking: false,
    shopKey: 'usersConsequenceShopsReactivate',
    ConfirmIcon: LockOpen,
    confirmVariant: 'default',
  },
  unban: {
    titleKey: 'usersDialogUnbanTitle',
    introKey: 'usersDialogUnbanIntro',
    confirmKey: 'usersDialogUnbanConfirm',
    placeholderKey: 'usersReasonPlaceholderUnlock',
    isLocking: false,
    shopKey: 'usersConsequenceShopsUnban',
    ConfirmIcon: LockOpen,
    confirmVariant: 'default',
  },
} as const satisfies Record<
  AdminUserAction,
  {
    titleKey: string;
    introKey: string;
    confirmKey: string;
    placeholderKey: string;
    // Khoá / cấm đăng xuất người dùng ngay; mở lại / gỡ cấm cho đăng nhập lại.
    isLocking: boolean;
    shopKey: string;
    ConfirmIcon: LucideIcon;
    // Khoá / cấm là hành động gây hại cho người khác nên nút xác nhận màu cảnh báo; mở lại / gỡ cấm là nút chính.
    confirmVariant: 'destructive' | 'default';
  }
>;

interface AdminUserReasonDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  action: AdminUserAction;
  user: AdminUserActionTarget;
  isPending: boolean;
  // Lỗi của lần xác nhận trước (đã dịch) — hiện ngay trong hộp thoại, giữ nguyên lý do Admin đã gõ.
  error: string | null;
  onConfirm: (reason: string) => void;
}

// Form chỉ mount khi hộp thoại mở (mỗi lần mở là một form trống). Nút xác nhận KHÔNG phải AlertDialogAction — action đó tự
// đóng ngay khi bấm, còn ở đây phải giữ hộp thoại mở (và khoá) tới khi yêu cầu xong; lỗi cũng giữ hộp thoại mở để Admin không
// mất lý do vừa gõ.
function AdminUserReasonForm({
  action,
  user,
  isPending,
  error,
  onConfirm,
}: Omit<AdminUserReasonDialogProps, 'open' | 'onOpenChange'>) {
  const t = useTranslations('admin');
  const translateValidation = useValidationMessage();
  const copy = COPY[action];
  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<UserReasonFormInput>({
    resolver: zodResolver(userReasonFormSchema),
    defaultValues: { reason: '' },
  });
  const reasonLength = (useWatch({ control, name: 'reason' }) ?? '').length;
  const isTooLong = reasonLength > ADMIN_USER_REASON_MAX_LENGTH;
  const reasonId = useId();
  const hasReasonError = Boolean(errors.reason);

  return (
    <form
      onSubmit={handleSubmit((values) => onConfirm(values.reason))}
      noValidate
      className="flex flex-col gap-4"
    >
      <AlertDialogHeader className="place-items-start text-left">
        <AlertDialogTitle>{t(copy.titleKey)}</AlertDialogTitle>
        <AlertDialogDescription className="[overflow-wrap:anywhere]">
          <span className="block font-medium text-foreground">
            {t('usersDialogTarget', { name: user.name, email: user.email })}
          </span>
          <span className="block">{t(copy.introKey)}</span>
        </AlertDialogDescription>
      </AlertDialogHeader>

      <ul
        aria-label={t('usersConsequencesLabel')}
        className="flex flex-col gap-2 rounded-lg border border-border bg-muted/40 p-3"
      >
        <AdminConsequenceItem Icon={copy.isLocking ? LogOut : LogIn}>
          {t(copy.isLocking ? 'usersConsequenceSignOut' : 'usersConsequenceSignIn')}
        </AdminConsequenceItem>
        <AdminConsequenceItem Icon={Store}>{t(copy.shopKey)}</AdminConsequenceItem>
        <AdminConsequenceItem Icon={Mail}>
          {t('usersConsequenceEmail', { email: user.email })}
        </AdminConsequenceItem>
        {action === 'unban' && user.statusReason ? (
          <AdminConsequenceItem Icon={TriangleAlert}>
            <span title={user.statusReason} className="line-clamp-3">
              {t('usersDialogUnbanWarning', { reason: user.statusReason })}
            </span>
          </AdminConsequenceItem>
        ) : null}
      </ul>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={reasonId}>
          {t('usersReasonLabel')}{' '}
          <span className="font-normal text-muted-foreground">{t('usersReasonHint')}</span>
        </Label>
        <Textarea
          id={reasonId}
          rows={3}
          disabled={isPending}
          placeholder={t(copy.placeholderKey)}
          aria-invalid={hasReasonError ? true : undefined}
          aria-describedby={hasReasonError ? `${reasonId}-error` : undefined}
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
              isTooLong ? 'text-destructive' : 'text-muted-foreground',
            )}
          >
            {t('usersReasonCounter', { count: reasonLength, max: ADMIN_USER_REASON_MAX_LENGTH })}
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
      </div>

      <AlertDialogFooter>
        <AlertDialogCancel disabled={isPending}>{t('dialogBack')}</AlertDialogCancel>
        <Button
          type="submit"
          variant={copy.confirmVariant}
          className={
            copy.confirmVariant === 'destructive'
              ? ADMIN_DESTRUCTIVE_CONFIRM_BUTTON_CLASS
              : undefined
          }
          disabled={isPending}
          aria-busy={isPending || undefined}
        >
          {isPending ? (
            <LoaderCircle
              aria-hidden="true"
              data-icon="inline-start"
              className="animate-spin motion-reduce:animate-none"
            />
          ) : (
            <copy.ConfirmIcon aria-hidden="true" data-icon="inline-start" />
          )}
          {isPending ? t('usersDialogPending') : t(copy.confirmKey)}
        </Button>
      </AlertDialogFooter>
    </form>
  );
}

// Bốn hành động đều đổi quyền truy cập của một người nên nằm sau xác nhận, và LÝ DO BẮT BUỘC — lý do đi vào nhật ký quản trị
// và email gửi cho chủ tài khoản (cột trạng thái của dòng cũng hiện nó). Hậu quả được liệt kê tường minh ngay trong hộp thoại.
export function AdminUserReasonDialog({
  open,
  onOpenChange,
  ...formProps
}: AdminUserReasonDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      {/* Giới hạn theo chiều cao khung nhìn và tự cuộn: màn thấp (điện thoại ngang, iPhone SE) không được làm nút xác nhận rơi ra
          ngoài màn hình. */}
      <AlertDialogContent className="data-[size=default]:sm:max-w-md max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <AdminUserReasonForm {...formProps} />
      </AlertDialogContent>
    </AlertDialog>
  );
}
