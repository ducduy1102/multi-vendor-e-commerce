'use client';

import { parseValidationMessage, type ValidationMessageParams } from '@ecommerce/types';
import { useTranslations } from 'next-intl';

// Key lấy từ message lúc chạy (không biết trước lúc compile) nên không thể qua
// kiểu key chặt của next-intl — ép về translator nhận key chuỗi tuỳ ý.
interface LooseTranslator {
  (key: string, params?: ValidationMessageParams): string;
  has(key: string): boolean;
}

// Dịch `message` lỗi validate của schema Zod (react-hook-form `errors.x.message`).
// Message là key i18n (kèm tham số nếu có) — xem validation-message.ts ở
// packages/types. Message không phải key có trong bản dịch (vd lỗi lạ) thì
// hiện nguyên chuỗi, không làm vỡ UI.
export function useValidationMessage() {
  const t = useTranslations() as unknown as LooseTranslator;

  return (message: string | undefined): string | undefined => {
    if (!message) {
      return undefined;
    }
    const { key, params } = parseValidationMessage(message);
    return t.has(key) ? t(key, params) : message;
  };
}
