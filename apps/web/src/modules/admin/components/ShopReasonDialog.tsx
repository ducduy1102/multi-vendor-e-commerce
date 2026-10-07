'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
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
import { useValidationMessage } from '@/shared/hooks/useValidationMessage';

import { shopReasonFormSchema, type ShopReasonFormInput } from '../schemas/admin.schema';

export type ShopReasonDialogKind = 'reject' | 'suspend';

// Chữ của từng loại hộp thoại — cùng 1 form (lý do bắt buộc), khác tiêu đề/mô tả/nhãn/nút.
const KIND_KEYS = {
  reject: {
    title: 'rejectDialogTitle',
    description: 'rejectDialogDescription',
    label: 'rejectReasonLabel',
    confirm: 'rejectDialogConfirm',
  },
  suspend: {
    title: 'suspendDialogTitle',
    description: 'suspendDialogDescription',
    label: 'suspendReasonLabel',
    confirm: 'suspendDialogConfirm',
  },
} as const;

interface ShopReasonDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: ShopReasonDialogKind;
  shopName: string;
  isPending: boolean;
  onConfirm: (reason: string) => void;
}

// Từ chối/khoá shop ảnh hưởng tới người khác (chủ shop không bán được, sản phẩm biến khỏi sàn) nên
// nằm sau xác nhận, và LÝ DO BẮT BUỘC — chủ shop thấy đúng lý do này ở trang quản lý shop của họ.
// Form chỉ mount khi hộp thoại mở (mỗi lần mở là 1 form trống). Nút xác nhận KHÔNG phải
// AlertDialogAction — action đó tự đóng ngay khi bấm, còn ở đây phải giữ hộp thoại mở (nút khoá) tới
// khi yêu cầu xong.
function ShopReasonForm({
  kind,
  shopName,
  isPending,
  onConfirm,
}: Pick<ShopReasonDialogProps, 'kind' | 'shopName' | 'isPending' | 'onConfirm'>) {
  const t = useTranslations('admin');
  const translateValidation = useValidationMessage();
  const keys = KIND_KEYS[kind];
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ShopReasonFormInput>({
    resolver: zodResolver(shopReasonFormSchema),
    defaultValues: { reason: '' },
  });

  return (
    <form
      onSubmit={handleSubmit((values) => onConfirm(values.reason))}
      noValidate
      className="flex flex-col gap-4"
    >
      <AlertDialogHeader>
        <AlertDialogTitle>{t(keys.title)}</AlertDialogTitle>
        <AlertDialogDescription>{t(keys.description, { name: shopName })}</AlertDialogDescription>
      </AlertDialogHeader>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="shop-reason">{t(keys.label)}</Label>
        <Textarea
          id="shop-reason"
          aria-invalid={errors.reason ? true : undefined}
          aria-describedby={errors.reason ? 'shop-reason-error' : undefined}
          {...register('reason')}
        />
        {errors.reason ? (
          <p id="shop-reason-error" role="alert" className="text-sm text-destructive">
            {translateValidation(errors.reason.message)}
          </p>
        ) : null}
      </div>

      <AlertDialogFooter>
        <AlertDialogCancel disabled={isPending}>{t('dialogBack')}</AlertDialogCancel>
        <Button type="submit" variant="destructive" disabled={isPending}>
          {t(keys.confirm)}
        </Button>
      </AlertDialogFooter>
    </form>
  );
}

export function ShopReasonDialog({
  open,
  onOpenChange,
  kind,
  shopName,
  isPending,
  onConfirm,
}: ShopReasonDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <ShopReasonForm
          kind={kind}
          shopName={shopName}
          isPending={isPending}
          onConfirm={onConfirm}
        />
      </AlertDialogContent>
    </AlertDialog>
  );
}
