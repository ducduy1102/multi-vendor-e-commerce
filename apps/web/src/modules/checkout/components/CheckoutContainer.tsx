'use client';

import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';

import { Link, useRouter } from '@/i18n/navigation';
import { useAuthStore } from '@/modules/auth';
import { useCart } from '@/modules/cart';
import { Button } from '@/shared/components/ui/button';
import type { LooseTranslator } from '@/shared/hooks/useValidationMessage';
import { ApiError } from '@/shared/lib/api-client';
import { ERROR_CODE_MESSAGE_KEYS, getErrorCode, getErrorDetails } from '@/shared/lib/error-codes';

import { useAddresses } from '../hooks/useAddresses';
import { useCheckoutPreview } from '../hooks/useCheckoutPreview';
import { usePlaceOrder } from '../hooks/usePlaceOrder';
import { getUnknownResultHintKey } from '../place-order-hint';
import { buildShopNotes } from '../shop-notes';
import type { Address, PaymentMethod } from '../types';
import { AddressFormContainer } from './AddressFormContainer';
import { AddressRadioList } from './AddressRadioList';
import { CheckoutOrderGroup } from './CheckoutOrderGroup';
import { CHECKOUT_LAYOUT_CLASS, CheckoutSkeleton } from './CheckoutSkeleton';
import { CheckoutSummary, type OutOfStockItem } from './CheckoutSummary';

interface CheckoutContainerProps {
  // Mã voucher đã áp ở /cart, mang sang qua ?voucher= (Week7.md 3.4) — chỉ MANG SANG, không có ô
  // sửa ở trang này; BE luôn kiểm lại (không tin FE), mã sai/hết hạn thì preview trả lỗi bình
  // thường qua nhánh error.
  initialVoucherCode?: string;
}

// Nối dữ liệu (sổ địa chỉ, POST /checkout/preview, POST /checkout) với UI thuần — page.tsx
// (composition root) chỉ truyền `initialVoucherCode` xuống, không viết logic nghiệp vụ trực tiếp
// (rules/frontend.md mục 1). Đủ 3 trạng thái loading/error/empty (rules/frontend.md mục 10).
export function CheckoutContainer({ initialVoucherCode = '' }: CheckoutContainerProps) {
  const t = useTranslations('checkout');
  const tCommon = useTranslations('common');
  const tHome = useTranslations('home');
  const tGlobal = useTranslations() as unknown as LooseTranslator;
  const router = useRouter();

  const user = useAuthStore((state) => state.user);
  const isHydrating = useAuthStore((state) => state.isHydrating);

  // Chỉ dùng useCart() (Week7.md 3.4) để biết NHANH giỏ có trống hẳn hay không (0 dòng, kể cả dòng
  // không khả dụng) — tránh gọi POST /checkout/preview (có ghi log/side-effect đọc DB nặng hơn) chỉ
  // để nhận lại 400 NO_PURCHASABLE_ITEMS cho 1 giỏ trống trơn. Giỏ có dòng nhưng TOÀN BỘ không khả
  // dụng vẫn phải qua preview thật vì useCart() không tự phân biệt được điều đó.
  const cartQuery = useCart();
  const addressesQuery = useAddresses();
  const placeOrder = usePlaceOrder();

  // Chỉ giữ LỰA CHỌN THỦ CÔNG của người dùng — giá trị hiệu lực thật sự (`selectedAddressId`,
  // `paymentMethod` bên dưới) được SUY RA lúc render từ override + dữ liệu mới nhất, không dùng
  // useEffect + setState để "tự chọn mặc định" (bị lint react-hooks/set-state-in-effect chặn, gây
  // render thừa — cùng pattern ProductGallery.tsx). Nhờ vậy override hết hiệu lực tự nhiên khi
  // không còn hợp lệ (địa chỉ bị xoá, phương thức hết khả dụng) mà không cần code dọn dẹp riêng.
  const [addressOverride, setAddressOverride] = useState<string | null>(null);
  const [paymentMethodOverride, setPaymentMethodOverride] = useState<PaymentMethod | null>(null);
  const [showAddressForm, setShowAddressForm] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [outOfStockItems, setOutOfStockItems] = useState<OutOfStockItem[]>([]);
  const [hasPendingCheckouts, setHasPendingCheckouts] = useState(false);
  // Lời nhắn đang gõ cho từng shop, khoá = shopId (Week8.md 3B). Giữ ở Container (không ở từng khối
  // shop) để không mất chữ đã gõ khi xem trước tải lại (đổi địa chỉ, giá đổi) làm khối dựng lại.
  const [shopNotes, setShopNotes] = useState<Record<string, string>>({});

  // UUID sinh 1 LẦN cho cả phiên đặt hàng (Week7.md 1.11), giữ trong bộ nhớ trang (không
  // localStorage) — gửi kèm mọi lần gọi POST /checkout của phiên này, kể cả gọi lại sau lỗi mạng,
  // chỉ đổi sau khi đặt hàng THÀNH CÔNG. Lazy ref init (không phải useState) vì giá trị này không
  // ảnh hưởng gì tới UI render, tránh re-render thừa; an toàn với StrictMode double-invoke nhờ
  // check `=== null` trước khi gán (rules/frontend.md mục 8).
  const idempotencyKeyRef = useRef<string | null>(null);
  if (idempotencyKeyRef.current === null) {
    idempotencyKeyRef.current = crypto.randomUUID();
  }

  const addresses = addressesQuery.data ?? [];
  // Mặc định địa chỉ mặc định của user (hoặc địa chỉ đầu tiên) — người dùng chọn địa chỉ khác thì
  // addressOverride thắng, miễn địa chỉ đó còn tồn tại trong danh sách.
  const defaultAddressId =
    (addresses.find((address) => address.isDefault) ?? addresses[0])?.id ?? null;
  const selectedAddressId =
    addressOverride && addresses.some((address) => address.id === addressOverride)
      ? addressOverride
      : defaultAddressId;

  const cartIsEmpty =
    !cartQuery.isPending && !cartQuery.isError && (cartQuery.cart?.shops.length ?? 0) === 0;
  const previewEnabled = !cartQuery.isPending && !cartIsEmpty;

  const previewQuery = useCheckoutPreview(
    { addressId: selectedAddressId ?? undefined, voucherCode: initialVoucherCode || undefined },
    { enabled: previewEnabled },
  );

  const paymentMethods = previewQuery.data?.paymentMethods ?? [];
  // Mặc định phương thức KHẢ DỤNG đầu tiên (Week7.md 3.4 "Bổ sung theo 1.9") — override chỉ thắng
  // khi phương thức đó VẪN khả dụng theo preview mới nhất (vd sau khi refetch vì
  // PAYMENT_METHOD_UNAVAILABLE), nên không cần tự "reset" override ở nơi khác.
  const overrideMethodAvailable = paymentMethods.some(
    (method) => method.method === paymentMethodOverride && method.available,
  );
  const paymentMethod = overrideMethodAvailable
    ? paymentMethodOverride
    : (paymentMethods.find((method) => method.available)?.method ?? null);

  function handleAddressCreated(address: Address) {
    setAddressOverride(address.id);
    setShowAddressForm(false);
  }

  function handlePlaceOrderError(error: unknown, method: PaymentMethod) {
    if (!(error instanceof ApiError)) {
      setSubmitError(t('placeOrderGenericError'));
      return;
    }
    const code = getErrorCode(error);
    if (!code) {
      setSubmitError(t('placeOrderGenericError'));
      return;
    }

    // Mất mạng/phản hồi hỏng: KHÔNG rõ đơn đã tạo hay chưa — giữ nguyên Idempotency-Key, không
    // refetch preview (chưa chắc gì đã đổi), chỉ báo và cho thử lại (Week7.md 1.11/1.16).
    if (code === 'NETWORK_ERROR' || code === 'INVALID_RESPONSE') {
      setSubmitError(
        `${tGlobal(ERROR_CODE_MESSAGE_KEYS[code])} ${t(getUnknownResultHintKey(method))}`,
      );
      return;
    }

    setSubmitError(tGlobal(ERROR_CODE_MESSAGE_KEYS[code]));

    if (code === 'OUT_OF_STOCK') {
      setOutOfStockItems(getErrorDetails(error.details, 'OUT_OF_STOCK')?.items ?? []);
    }
    if (code === 'TOO_MANY_PENDING_CHECKOUTS') {
      setHasPendingCheckouts(true);
    }
    // Mọi mã nghiệp vụ còn lại là KẾT QUẢ CHẮC CHẮN (đơn không được tạo) — tải lại xem trước để
    // người dùng thấy số/danh sách mới nhất trước khi tự quyết định đặt lại (1.11/1.16).
    if (
      code === 'PRICE_CHANGED' ||
      code === 'CART_CHANGED' ||
      code === 'OUT_OF_STOCK' ||
      code === 'PAYMENT_METHOD_UNAVAILABLE'
    ) {
      void previewQuery.refetch();
    }
    // CART_CHANGED nghĩa là chính giỏ hàng (không chỉ giá/tồn kho) đã đổi — tải lại cả useCart()
    // để nhánh "giỏ trống hẳn" (cartIsEmpty) cũng phản ánh đúng trạng thái mới nhất.
    if (code === 'CART_CHANGED') {
      void cartQuery.refetch();
    }
  }

  async function handleSubmit() {
    const preview = previewQuery.data;
    if (!preview || !selectedAddressId || !paymentMethod || preview.grandTotal === null) return;

    setSubmitError(null);
    setOutOfStockItems([]);
    setHasPendingCheckouts(false);

    try {
      const result = await placeOrder.mutateAsync({
        input: {
          addressId: selectedAddressId,
          paymentMethod,
          voucherCode: initialVoucherCode || undefined,
          expectedTotal: Number(preview.grandTotal),
          shopNotes: buildShopNotes(preview.orders, shopNotes),
        },
        idempotencyKey: idempotencyKeyRef.current ?? undefined,
      });
      // Đổi key SAU KHI đặt thành công (Week7.md 1.11) — nhóm vừa tạo đã "chốt" dưới key cũ.
      idempotencyKeyRef.current = crypto.randomUUID();

      if (result.paymentUrl) {
        // Redirect full-page sang cổng thanh toán (Week7.md 3.4) — không dùng router nội bộ vì
        // đây là URL bên ngoài (VNPay/Momo).
        window.location.href = result.paymentUrl;
        return;
      }
      // Không có paymentUrl thì không có cổng để chuyển sang, đi thẳng trang kết quả theo groupId.
      // Hai trường hợp: (1) đơn COD (Week8.md 1.6/3.6) — paymentUrl null là KẾT QUẢ ĐÚNG, đơn đã vào
      // PENDING và trang kết quả báo "thanh toán khi nhận hàng"; (2) cổng online lỗi sau khi đã ghi
      // đơn — đơn vẫn AWAITING_PAYMENT, người dùng tự bấm "thanh toán lại" ở đó (Week7.md 2.7/3.6).
      // Giỏ hàng được làm mới ở trang kết quả (useRefreshCartOnce), không ở đây — làm ở đây sẽ khiến
      // trang này thấy giỏ trống và nháy "giỏ hàng trống" trong lúc chờ điều hướng.
      router.push({ pathname: '/checkout/result', query: { groupId: result.checkoutGroupId } });
    } catch (error) {
      handlePlaceOrderError(error, paymentMethod);
    }
  }

  // Chặn sớm khi email chưa xác thực (Week7.md 1.2, cùng pattern BecomeSellerFormContainer) — nút
  // "Gửi lại xác thực" đã có sẵn ở EmailVerificationBanner toàn app (app/[locale]/layout.tsx), ở
  // đây chỉ giải thích ngắn gọn vì sao không thấy phần đặt hàng, không lặp CTA thứ 2. Chờ
  // isHydrating xong mới kết luận (tránh hiện nhầm "chưa xác thực" cho user thật ra đã xác thực).
  if (isHydrating) {
    return (
      <div aria-busy="true">
        <span className="sr-only">{tCommon('loading')}</span>
        <CheckoutSkeleton />
      </div>
    );
  }

  if (user && !user.emailVerifiedAt) {
    return <p className="text-sm text-muted-foreground">{t('emailNotVerifiedNotice')}</p>;
  }

  const isLoading =
    cartQuery.isPending || (previewEnabled && previewQuery.isPending) || addressesQuery.isPending;
  if (isLoading) {
    return (
      <div aria-busy="true">
        <span className="sr-only">{tCommon('loading')}</span>
        <CheckoutSkeleton />
      </div>
    );
  }

  if (cartIsEmpty || previewQuery.data === null) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-sm text-muted-foreground">{t('emptyState')}</p>
        <Button nativeButton={false} render={<Link href="/products" />}>
          {tHome('bannerCta')}
        </Button>
      </div>
    );
  }

  if (previewQuery.isError || addressesQuery.isError) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p role="alert" className="text-sm text-destructive">
          {t('loadError')}
        </p>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            void previewQuery.refetch();
            void addressesQuery.refetch();
          }}
        >
          {t('retry')}
        </Button>
      </div>
    );
  }

  const preview = previewQuery.data;
  if (!preview) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {t('loadError')}
      </p>
    );
  }
  const canSubmit =
    Boolean(selectedAddressId) &&
    Boolean(paymentMethod) &&
    preview.canPlaceOrder &&
    !preview.needsAddress &&
    preview.grandTotal !== null;

  return (
    <div className={CHECKOUT_LAYOUT_CLASS}>
      <div className="flex flex-col gap-4">
        <section
          aria-label={t('addressSectionTitle')}
          className="flex flex-col gap-3 rounded-lg border border-border bg-background p-4"
        >
          <h2 className="text-base font-semibold text-foreground">{t('addressSectionTitle')}</h2>
          <AddressRadioList
            addresses={addresses}
            selectedId={selectedAddressId}
            onSelect={setAddressOverride}
          />
          {showAddressForm ? (
            <div className="flex flex-col items-start gap-2">
              <AddressFormContainer onCreated={handleAddressCreated} />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setShowAddressForm(false)}
              >
                {tCommon('cancel')}
              </Button>
            </div>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="self-start"
              onClick={() => setShowAddressForm(true)}
            >
              {t('addAddressButton')}
            </Button>
          )}
        </section>

        {preview.orders.map((order) => (
          <CheckoutOrderGroup
            key={order.shopId}
            order={order}
            note={shopNotes[order.shopId] ?? ''}
            onNoteChange={(note) =>
              setShopNotes((current) => ({ ...current, [order.shopId]: note }))
            }
          />
        ))}
      </div>

      <CheckoutSummary
        preview={preview}
        paymentMethod={paymentMethod}
        onSelectPaymentMethod={setPaymentMethodOverride}
        onSubmit={() => void handleSubmit()}
        isSubmitting={placeOrder.isPending}
        canSubmit={canSubmit}
        submitError={submitError}
        outOfStockItems={outOfStockItems}
        hasPendingCheckouts={hasPendingCheckouts}
      />
    </div>
  );
}
