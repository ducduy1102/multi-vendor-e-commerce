'use client';

import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';

import { Alert } from '@/shared/components/ui/alert';
import { useApiErrorMessage } from '@/shared/hooks/useValidationMessage';
import type { LooseTranslator } from '@/shared/hooks/useValidationMessage';
import { ApiError } from '@/shared/lib/api-client';
import { ERROR_CODE_MESSAGE_KEYS, getErrorCode } from '@/shared/lib/error-codes';

import { useCreateAddress } from '../hooks/useCreateAddress';
import { useUpdateAddress } from '../hooks/useUpdateAddress';
import type { AddressFormInput } from '../schemas/address.schema';
import type { Address } from '../types';
import { AddressForm } from './AddressForm';

interface AddressFormContainerProps {
  // Gọi lại sau khi tạo địa chỉ thành công — vd để /checkout (3.4) tự chọn địa chỉ vừa tạo
  // và đóng form. Không tự điều hướng/đóng gì ở đây, đó là quyết định của nơi ghép (page.tsx).
  onCreated?: (address: Address) => void;
  // Có `address` ⇒ chế độ SỬA địa chỉ đó (PATCH /addresses/:id, Week9.md 6.2), không có ⇒ tạo mới
  // (POST /addresses). Cùng một Container để mã lỗi/thông điệp chỉ được dịch ở một nơi.
  address?: Address;
  onUpdated?: (address: Address) => void;
  // Hiện nút "Hủy" cạnh nút lưu (form mở ngay trong trang — sổ địa chỉ).
  onCancel?: () => void;
}

// Nối AddressForm (UI + validate) với POST /addresses (useCreateAddress, Bước 3.1) hoặc PATCH
// /addresses/:id (useUpdateAddress) — đặt trong modules/ để nơi ghép (checkout/page.tsx, Bước 3.4)
// chỉ compose, không viết logic nghiệp vụ trực tiếp (rules/frontend.md mục 1).
//
// Lỗi 400 validate (message là key i18n, vd checkout.validationPhoneInvalid) dịch qua
// useApiErrorMessage() như mọi Container khác. Lỗi nghiệp vụ có `code` (409
// ADDRESS_LIMIT_REACHED — message chỉ là câu tiếng Anh thô, useApiErrorMessage() không dịch
// được) dịch qua hạ tầng mã lỗi (Bước 3.1b) — 2 nhánh không chồng lấn vì getErrorCode() trả
// undefined cho lỗi validate (không có `code`), rơi thẳng về nhánh useApiErrorMessage().
export function AddressFormContainer({
  onCreated,
  address,
  onUpdated,
  onCancel,
}: AddressFormContainerProps) {
  const t = useTranslations('checkout');
  const tApi = useApiErrorMessage();
  const tGlobal = useTranslations() as unknown as LooseTranslator;
  const createAddress = useCreateAddress();
  const updateAddress = useUpdateAddress();
  const [error, setError] = useState<string | null>(null);

  // Object ổn định theo NỘI DUNG địa chỉ: AddressForm điền lại form khi `initialValues` đổi, nên
  // không được tạo object mới mỗi lần render (sẽ ghi đè thứ người dùng đang gõ).
  const initialValues = useMemo<AddressFormInput | undefined>(
    () =>
      address
        ? {
            recipientName: address.recipientName,
            phone: address.phone,
            line1: address.line1,
            ward: address.ward,
            province: address.province,
          }
        : undefined,
    [address],
  );

  async function handleSubmit(values: AddressFormInput) {
    setError(null);
    try {
      if (address) {
        const updated = await updateAddress.mutateAsync({ id: address.id, input: values });
        onUpdated?.(updated);
      } else {
        const created = await createAddress.mutateAsync(values);
        onCreated?.(created);
      }
    } catch (err) {
      if (!(err instanceof ApiError)) {
        setError(t('addressFormGenericError'));
        return;
      }
      const code = getErrorCode(err);
      setError(code ? tGlobal(ERROR_CODE_MESSAGE_KEYS[code]) : tApi(err.message));
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <Alert variant="destructive" role="alert">
          {error}
        </Alert>
      )}
      <AddressForm
        onSubmit={handleSubmit}
        isSubmitting={createAddress.isPending || updateAddress.isPending}
        initialValues={initialValues}
        onCancel={onCancel}
      />
    </div>
  );
}
