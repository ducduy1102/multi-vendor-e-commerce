import { z } from 'zod';

// Input HTML bỏ trống gửi chuỗi rỗng "" — coi như chưa nhập (cùng cách `shop.ts`: `.transform()` ở CUỐI
// chain, không dùng z.preprocess để giữ input type cho zodResolver). Dùng chung cho order/refund/review;
// file nội bộ của package (không export ra index).
export const optionalText = (maxLength: number, tooLongMessage: string) =>
  z
    .string()
    .trim()
    .max(maxLength, tooLongMessage)
    .optional()
    .transform((value) => (value === '' ? undefined : value));
