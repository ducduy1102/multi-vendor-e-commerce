'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { Alert } from '@/shared/components/ui/alert';
import { useApiErrorMessage } from '@/shared/hooks/useValidationMessage';
import type { LooseTranslator } from '@/shared/hooks/useValidationMessage';
import { ApiError } from '@/shared/lib/api-client';
import { ERROR_CODE_MESSAGE_KEYS, getErrorCode } from '@/shared/lib/error-codes';

import { useCreateAddress } from '../hooks/useCreateAddress';
import type { AddressFormInput } from '../schemas/address.schema';
import type { Address } from '../types';
import { AddressForm } from './AddressForm';

interface AddressFormContainerProps {
  // Gọi lại sau khi tạo địa chỉ thành công — vd để /checkout (3.4) tự chọn địa chỉ vừa tạo
  // và đóng form. Không tự điều hướng/đóng gì ở đây, đó là quyết định của nơi ghép (page.tsx).
  onCreated?: (address: Address) => void;
}

// Nối AddressForm (UI + validate) với POST /addresses (useCreateAddress, Bước 3.1) — đặt
// trong modules/ để nơi ghép (checkout/page.tsx, Bước 3.4) chỉ compose, không viết logic
// nghiệp vụ trực tiếp (rules/frontend.md mục 1).
//
// Lỗi 400 validate (message là key i18n, vd checkout.validationPhoneInvalid) dịch qua
// useApiErrorMessage() như mọi Container khác. Lỗi nghiệp vụ có `code` (409
// ADDRESS_LIMIT_REACHED — message chỉ là câu tiếng Anh thô, useApiErrorMessage() không dịch
// được) dịch qua hạ tầng mã lỗi (Bước 3.1b) — 2 nhánh không chồng lấn vì getErrorCode() trả
// undefined cho lỗi validate (không có `code`), rơi thẳng về nhánh useApiErrorMessage().
export function AddressFormContainer({ onCreated }: AddressFormContainerProps) {
  const t = useTranslations('checkout');
  const tApi = useApiErrorMessage();
  const tGlobal = useTranslations() as unknown as LooseTranslator;
  const createAddress = useCreateAddress();
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(values: AddressFormInput) {
    setError(null);
    try {
      const address = await createAddress.mutateAsync(values);
      onCreated?.(address);
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
      <AddressForm onSubmit={handleSubmit} isSubmitting={createAddress.isPending} />
    </div>
  );
}
