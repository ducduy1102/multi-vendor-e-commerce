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
import { Input } from '@/shared/components/ui/input';
import { Label } from '@/shared/components/ui/label';
import { useValidationMessage } from '@/shared/hooks/useValidationMessage';

import { shipOrderSchema } from '../schemas/order.schema';
import type { ShipOrderInput } from '../types';

interface ShipOrderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isPending: boolean;
  onConfirm: (values: ShipOrderInput) => void;
}

// Cả 2 trường tuỳ chọn: shop nhỏ tự giao không có đơn vị vận chuyển/mã vận đơn, để trống vẫn giao
// được (Week8.md 1.10). Form nằm trong component riêng vì chỉ mount khi hộp thoại mở — mỗi lần mở
// là 1 form trống, không giữ lại mã vận đơn của đơn trước.
function ShipOrderForm({
  isPending,
  onConfirm,
}: Pick<ShipOrderDialogProps, 'isPending' | 'onConfirm'>) {
  const t = useTranslations('order');
  const translateValidation = useValidationMessage();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ShipOrderInput>({
    resolver: zodResolver(shipOrderSchema),
    defaultValues: { carrier: '', trackingCode: '' },
  });

  return (
    <form onSubmit={handleSubmit(onConfirm)} noValidate className="flex flex-col gap-4">
      <AlertDialogHeader>
        <AlertDialogTitle>{t('shipDialogTitle')}</AlertDialogTitle>
        <AlertDialogDescription>{t('shipDialogDescription')}</AlertDialogDescription>
      </AlertDialogHeader>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="ship-order-carrier">{t('shipCarrierLabel')}</Label>
        <Input
          id="ship-order-carrier"
          autoComplete="off"
          aria-invalid={errors.carrier ? true : undefined}
          aria-describedby={errors.carrier ? 'ship-order-carrier-error' : undefined}
          {...register('carrier')}
        />
        {errors.carrier ? (
          <p id="ship-order-carrier-error" role="alert" className="text-sm text-destructive">
            {translateValidation(errors.carrier.message)}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="ship-order-tracking-code">{t('shipTrackingCodeLabel')}</Label>
        <Input
          id="ship-order-tracking-code"
          autoComplete="off"
          aria-invalid={errors.trackingCode ? true : undefined}
          aria-describedby={errors.trackingCode ? 'ship-order-tracking-code-error' : undefined}
          {...register('trackingCode')}
        />
        {errors.trackingCode ? (
          <p id="ship-order-tracking-code-error" role="alert" className="text-sm text-destructive">
            {translateValidation(errors.trackingCode.message)}
          </p>
        ) : null}
      </div>

      <AlertDialogFooter>
        <AlertDialogCancel disabled={isPending}>{t('dialogBack')}</AlertDialogCancel>
        <Button type="submit" disabled={isPending}>
          {t('shipDialogConfirm')}
        </Button>
      </AlertDialogFooter>
    </form>
  );
}

export function ShipOrderDialog({
  open,
  onOpenChange,
  isPending,
  onConfirm,
}: ShipOrderDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <ShipOrderForm isPending={isPending} onConfirm={onConfirm} />
      </AlertDialogContent>
    </AlertDialog>
  );
}
