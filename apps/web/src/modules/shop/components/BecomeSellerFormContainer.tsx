'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

// useAuthStore tái dùng qua barrel export công khai của module auth
// (@/modules/auth), không reach vào file nội bộ — coi barrel là "API surface"
// của module, giống cách rules/general.md mục 1 cho phép lấy dữ liệu module
// khác qua API/packages/types. Xác thực email vẫn là khái niệm của domain
// auth (User.emailVerifiedAt), shop chỉ đọc lại để feature-gate.
import { useAuthStore } from '@/modules/auth';
import { useRouter } from '@/i18n/navigation';
import { Alert } from '@/shared/components/ui/alert';
import { ApiError } from '@/shared/lib/api-client';
import { useApiErrorMessage } from '@/shared/hooks/useValidationMessage';

import { useCreateShop } from '../hooks/useCreateShop';
import { useMyShop } from '../hooks/useMyShop';
import type { CreateShopInput } from '../types';
import { BecomeSellerForm } from './BecomeSellerForm';
import { ShopFormFieldsSkeleton } from './ShopFormFieldsSkeleton';

export function BecomeSellerFormContainer() {
  const t = useTranslations('shop');
  const tApi = useApiErrorMessage();
  const tCommon = useTranslations('common');
  const router = useRouter();
  const user = useAuthStore((state) => state.user);
  const isHydrating = useAuthStore((state) => state.isHydrating);
  const myShopQuery = useMyShop();
  const createShop = useCreateShop();
  const [error, setError] = useState<string | null>(null);

  // Đã có shop rồi thì không cho tạo lại (đúng giới hạn 1 shop/user, Bước
  // 1.6) — điều hướng sang trang quản lý shop (Bước 3.8) thay vì hiện form.
  useEffect(() => {
    if (myShopQuery.data) {
      router.push('/seller/shop');
    }
  }, [myShopQuery.data, router]);

  async function handleSubmit(values: CreateShopInput) {
    setError(null);
    try {
      await createShop.mutateAsync(values);
      router.push('/seller/shop');
    } catch (err) {
      setError(err instanceof ApiError ? tApi(err.message) : t('becomeSellerGenericError'));
    }
  }

  // isHydrating: chưa biết chắc user đã xác thực email hay chưa (xem
  // auth.store.ts) — đánh giá `user?.emailVerifiedAt` lúc này dễ hiện nhầm
  // "chưa xác thực" cho user thật ra đã xác thực, chỉ vì AuthHydrator chưa
  // kịp trả lời. isPending lúc đầu (chưa biết đã có shop chưa) hoặc đã có
  // data (đang chờ useEffect điều hướng ở trên) — không render form/thông
  // báo nhầm.
  if (isHydrating || myShopQuery.isPending || myShopQuery.data) {
    return (
      <div aria-busy="true">
        <span className="sr-only">{tCommon('loading')}</span>
        <ShopFormFieldsSkeleton />
      </div>
    );
  }

  // `getMyShop()` chỉ trả null cho 404 (chưa có shop) — lỗi khác (401 chưa
  // đăng nhập, 500...) rethrow qua đây. Chưa redirect sang /login ở bước này
  // (đó là việc của route guard proxy.ts, Bước 3.9, chạy trước khi trang này
  // kịp render) — hiện chỉ tránh treo mãi ở trạng thái loading.
  if (myShopQuery.isError) {
    return <p className="text-sm text-destructive">{t('loadShopError')}</p>;
  }

  // Nút "Gửi lại xác thực" đã có sẵn ở EmailVerificationBanner (toàn app,
  // app/[locale]/layout.tsx) — hiện ngay phía trên form này khi email chưa
  // xác thực, nên ở đây chỉ giải thích ngắn gọn vì sao form đang khoá, không
  // lặp lại CTA thứ 2 (UI polish, chốt sau audit).
  if (!user?.emailVerifiedAt) {
    return (
      <p className="text-sm text-muted-foreground">{t('becomeSellerEmailNotVerifiedShort')}</p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <Alert variant="destructive" role="alert">
          {error}
        </Alert>
      )}
      <BecomeSellerForm onSubmit={handleSubmit} isSubmitting={createShop.isPending} />
    </div>
  );
}
