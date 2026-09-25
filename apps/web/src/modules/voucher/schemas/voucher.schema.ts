import { createVoucherSchema, type CreateVoucherInput } from '@ecommerce/types';
import { z } from 'zod';

// Form giữ MỌI field ở dạng chuỗi (đúng giá trị input HTML trả về) để input
// === output type, tránh lỗi type khi ghép zodResolver + useForm<T>
// (rules/frontend.md mục 4). Chuyển sang số/ISO ở toCreateVoucherInput ngay
// trước khi gửi, không dựa vào Zod transform. Thông điệp lỗi viết thẳng tiếng
// Việt như các schema form hiện có (auth/shop/product) — chưa qua next-intl.
export interface VoucherFormValues {
  code: string;
  type: 'PERCENT' | 'FIXED';
  value: string;
  minOrderAmount: string;
  maxDiscountAmount: string;
  usageLimit: string;
  perUserLimit: string;
  // Giá trị input datetime-local ('YYYY-MM-DDTHH:mm', giờ địa phương) hoặc ''.
  expiresAt: string;
}

export const EMPTY_VOUCHER_FORM_VALUES: VoucherFormValues = {
  code: '',
  type: 'PERCENT',
  value: '',
  minOrderAmount: '',
  maxDiscountAmount: '',
  usageLimit: '',
  perUserLimit: '',
  expiresAt: '',
};

const INVALID_NUMBER = 'Vui lòng nhập số hợp lệ';
const VOUCHER_CODE_PATTERN = /^[A-Za-z0-9_-]{3,32}$/;
const VOUCHER_CODE_MESSAGE = 'Mã chỉ gồm chữ, số, gạch ngang/gạch dưới, dài 3-32 ký tự';

function isBlank(value: string): boolean {
  return value.trim() === '';
}

function isValidNumber(value: string): boolean {
  return !isBlank(value) && Number.isFinite(Number(value));
}

function optionalNumber(value: string): number | undefined {
  return isBlank(value) ? undefined : Number(value);
}

// Ô số lượng: chuỗi rỗng = không giới hạn/không đặt, khác rỗng phải là số.
const NUMERIC_OPTIONAL_FIELDS = [
  'minOrderAmount',
  'maxDiscountAmount',
  'usageLimit',
  'perUserLimit',
] as const;

export function toCreateVoucherInput(values: VoucherFormValues): CreateVoucherInput {
  const expiresAt = isBlank(values.expiresAt) ? undefined : new Date(values.expiresAt);

  return {
    code: values.code.trim(),
    type: values.type,
    value: Number(values.value),
    minOrderAmount: optionalNumber(values.minOrderAmount),
    // Mức giảm tối đa chỉ có nghĩa với PERCENT (BE từ chối với FIXED) — bỏ đi
    // nếu người dùng đổi sang FIXED sau khi đã nhập.
    maxDiscountAmount:
      values.type === 'PERCENT' ? optionalNumber(values.maxDiscountAmount) : undefined,
    usageLimit: optionalNumber(values.usageLimit),
    perUserLimit: optionalNumber(values.perUserLimit),
    expiresAt: expiresAt ? expiresAt.toISOString() : undefined,
  };
}

// Bước 1 kiểm định dạng số từng ô, bước 2 (khi tất cả đều là số) tái dùng
// đúng createVoucherSchema của BE (packages/types) cho các luật nghiệp vụ —
// PERCENT ≤ 100, FIXED nguyên đồng, maxDiscount chỉ cho PERCENT, giới hạn
// lượt là số nguyên ≥ 1... — để FE và BE không bao giờ lệch nhau.
export const voucherFormSchema = z
  .object({
    code: z.string().trim(),
    type: z.enum(['PERCENT', 'FIXED']),
    value: z.string().trim(),
    minOrderAmount: z.string().trim(),
    maxDiscountAmount: z.string().trim(),
    usageLimit: z.string().trim(),
    perUserLimit: z.string().trim(),
    expiresAt: z.string().trim(),
  })
  .superRefine((values, ctx) => {
    let hasFormatError = false;
    // Cùng luật với voucherCodeSchema ở packages/types (không export riêng,
    // createVoucherSchema là ZodEffects nên không lấy .shape.code được) —
    // kiểm ngay ở bước 1 để lỗi mã hiện cùng lúc với lỗi ô khác.
    if (!VOUCHER_CODE_PATTERN.test(values.code)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['code'], message: VOUCHER_CODE_MESSAGE });
      hasFormatError = true;
    }
    if (isBlank(values.value)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['value'],
        message: 'Vui lòng nhập giá trị giảm',
      });
      hasFormatError = true;
    } else if (!isValidNumber(values.value)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['value'], message: INVALID_NUMBER });
      hasFormatError = true;
    }
    for (const field of NUMERIC_OPTIONAL_FIELDS) {
      if (!isBlank(values[field]) && !isValidNumber(values[field])) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [field], message: INVALID_NUMBER });
        hasFormatError = true;
      }
    }
    if (!isBlank(values.expiresAt)) {
      const expiresAt = new Date(values.expiresAt);
      if (Number.isNaN(expiresAt.getTime())) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['expiresAt'],
          message: 'Ngày hết hạn không hợp lệ',
        });
        hasFormatError = true;
      } else if (expiresAt.getTime() <= Date.now()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['expiresAt'],
          message: 'Ngày hết hạn phải ở tương lai',
        });
        hasFormatError = true;
      }
    }
    // Bước 2 chỉ chạy khi mọi ô đã đúng định dạng — nếu không, Zod báo lỗi
    // "Expected number, received nan" khó hiểu cho ô nhập sai.
    if (hasFormatError) return;

    const parsed = createVoucherSchema.safeParse(toCreateVoucherInput(values));
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: issue.path, message: issue.message });
      }
    }
  });
