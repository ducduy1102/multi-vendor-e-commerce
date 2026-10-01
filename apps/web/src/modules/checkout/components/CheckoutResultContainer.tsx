'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';

import { Link } from '@/i18n/navigation';
import { cartQueryKeys } from '@/modules/cart';
import { Button } from '@/shared/components/ui/button';
import type { LooseTranslator } from '@/shared/hooks/useValidationMessage';
import { ApiError } from '@/shared/lib/api-client';
import { ERROR_CODE_MESSAGE_KEYS, getErrorCode } from '@/shared/lib/error-codes';

import { useCheckoutGroup } from '../hooks/useCheckoutGroup';
import { useRetryPayment } from '../hooks/useRetryPayment';
import { CheckoutResultSkeleton } from './CheckoutResultSkeleton';
import { CheckoutResultView } from './CheckoutResultView';

interface CheckoutResultContainerProps {
  // null khi URL thiếu `groupId` hợp lệ (kể cả `?error=invalid` mà BE tự redirect tới khi chữ ký
  // cổng sai — order.controller.ts) — page.tsx (Server Component) đã kiểm UUID trước khi truyền
  // xuống, Container không tự đọc lại bất kỳ tham số nào khác của cổng thanh toán (Week7.md 1.10).
  groupId: string | null;
}

// Nối dữ liệu (GET /checkout/groups/:id có polling khi còn AWAITING_PAYMENT, POST .../pay) với UI
// thuần CheckoutResultView. Đủ 3 trạng thái loading/error/thành công (rules/frontend.md mục 10) +
// 1 nhánh riêng "liên kết không hợp lệ" khi thiếu groupId. Container không cần unit test
// (rules/frontend.md mục 8), state/nhánh hiển thị theo status đã có test đủ ở CheckoutResultView.
export function CheckoutResultContainer({ groupId }: CheckoutResultContainerProps) {
  const t = useTranslations('checkout');
  const tCommon = useTranslations('common');
  const tHome = useTranslations('home');
  const tGlobal = useTranslations() as unknown as LooseTranslator;
  const queryClient = useQueryClient();
  const [retryPaymentError, setRetryPaymentError] = useState<string | null>(null);

  const query = useCheckoutGroup(groupId ?? '');
  const retryPayment = useRetryPayment(groupId ?? '');

  // Badge giỏ hàng cần cập nhật ngay khi đơn đã thanh toán xong (giỏ đã bị xoá phần đã mua ở
  // placeOrder) — chỉ nên gọi 1 lần khi status CHUYỂN sang PAID, không lặp lại mỗi lần re-render
  // hay mỗi lần polling refetch trong khi vẫn PAID (rules/frontend.md mục 8, cùng tinh thần
  // CartHydrator/useClampCartToStock dù invalidateQueries tự nó vô hại khi gọi lặp).
  const hasInvalidatedCartRef = useRef(false);
  useEffect(() => {
    if (query.data?.status === 'PAID' && !hasInvalidatedCartRef.current) {
      hasInvalidatedCartRef.current = true;
      void queryClient.invalidateQueries({ queryKey: cartQueryKeys.all });
    }
  }, [query.data?.status, queryClient]);

  async function handleRetryPayment() {
    setRetryPaymentError(null);
    try {
      const result = await retryPayment.mutateAsync();
      // Redirect full-page sang cổng thanh toán — URL bên ngoài, không dùng router nội bộ (cùng
      // CheckoutContainer 3.4).
      window.location.href = result.paymentUrl;
    } catch (error) {
      if (error instanceof ApiError) {
        const code = getErrorCode(error);
        setRetryPaymentError(
          code ? tGlobal(ERROR_CODE_MESSAGE_KEYS[code]) : t('resultRetryGenericError'),
        );
        return;
      }
      setRetryPaymentError(t('resultRetryGenericError'));
    }
  }

  if (!groupId) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p role="alert" className="text-sm text-destructive">
          {t('resultInvalidLink')}
        </p>
        <Button nativeButton={false} render={<Link href="/products" />}>
          {tHome('bannerCta')}
        </Button>
      </div>
    );
  }

  if (query.isPending) {
    return (
      <div aria-busy="true">
        <span className="sr-only">{tCommon('loading')}</span>
        <CheckoutResultSkeleton />
      </div>
    );
  }

  if (query.isError || !query.data) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p role="alert" className="text-sm text-destructive">
          {t('resultLoadError')}
        </p>
        <Button type="button" variant="outline" onClick={() => void query.refetch()}>
          {t('retry')}
        </Button>
      </div>
    );
  }

  return (
    <CheckoutResultView
      group={query.data}
      onReload={() => void query.refetch()}
      isReloading={query.isFetching}
      onRetryPayment={() => void handleRetryPayment()}
      isRetryingPayment={retryPayment.isPending}
      retryPaymentError={retryPaymentError}
    />
  );
}
