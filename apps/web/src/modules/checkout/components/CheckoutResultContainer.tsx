'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { Link } from '@/i18n/navigation';
import { Button } from '@/shared/components/ui/button';
import type { LooseTranslator } from '@/shared/hooks/useValidationMessage';
import { ApiError } from '@/shared/lib/api-client';
import { ERROR_CODE_MESSAGE_KEYS, getErrorCode } from '@/shared/lib/error-codes';

import { useCheckoutGroup } from '../hooks/useCheckoutGroup';
import { useRefreshCartOnce } from '../hooks/useRefreshCartOnce';
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
  const [retryPaymentError, setRetryPaymentError] = useState<string | null>(null);

  const query = useCheckoutGroup(groupId ?? '');
  const retryPayment = useRetryPayment(groupId ?? '');

  // Giỏ đã bị xoá phần đã mua ngay lúc placeOrder (mọi phương thức, mọi trạng thái nhóm) nên làm mới
  // cache giỏ 1 lần khi nhóm tải xong — kể cả đơn COD (COD_PLACED) đi tới đây bằng điều hướng trong
  // ứng dụng nên biểu tượng giỏ trên Header/BottomTabBar không tự đúng lại. Trước đây chỉ làm mới khi
  // status là PAID nên giỏ COD bị bỏ sót. Chặn lặp bằng useRef ở hook (không làm mới lại theo polling).
  useRefreshCartOnce(Boolean(query.data));

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
        {/* Không biết đơn đã được tạo/thanh toán chưa (vd cổng báo chữ ký sai) — Đơn hàng của tôi là
            nơi xem kết quả thật. */}
        <div className="flex flex-wrap gap-2">
          <Button nativeButton={false} render={<Link href="/orders" />}>
            {t('resultViewOrdersButton')}
          </Button>
          <Button variant="outline" nativeButton={false} render={<Link href="/products" />}>
            {tHome('bannerCta')}
          </Button>
        </div>
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
