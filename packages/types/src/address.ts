import { z } from 'zod';
import { findProvince } from './province';

// Tối đa số địa chỉ / user (Week7.md 1.8) — kiểm ở service, vượt trần ⇒ 409.
export const MAX_ADDRESSES_PER_USER = 10;

// Số di động Việt Nam: 0 hoặc +84, đầu số 3/5/7/8/9, tổng 10 số. Đầu số do nhà mạng đổi theo
// thời gian nên regex nằm ở 1 hằng số dễ sửa. Không hỗ trợ số bàn (giao hàng cần liên lạc di động).
export const VIETNAM_MOBILE_REGEX = /^0[35789]\d{8}$/;

// Chuẩn hoá về dạng lưu `0xxxxxxxxx` (bỏ khoảng trắng/dấu chấm/gạch/ngoặc, +84 → 0);
// không hợp lệ ⇒ null.
export function normalizeVietnamPhone(raw: string): string | null {
  const compact = raw.replace(/[\s.\-()]/g, '');
  const local = compact.startsWith('+84') ? `0${compact.slice(3)}` : compact;
  return VIETNAM_MOBILE_REGEX.test(local) ? local : null;
}

// Không ký tự điều khiển (kể cả xuống dòng) trong dữ liệu sẽ in lên vận đơn.
// eslint-disable-next-line no-control-regex
const HAS_CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

const requiredText = (max: number, requiredKey: string, tooLongKey: string) =>
  z
    .string()
    .trim()
    .min(1, requiredKey)
    .max(max, tooLongKey)
    .refine((value) => !HAS_CONTROL_CHARS.test(value), requiredKey);

// Schema dùng cho FORM (input === output, không transform — `zodResolver` + `useForm<T>`
// cần 2 kiểu này khớp, xem rules/frontend.md mục 4). `phone`/`province` chỉ được kiểm hợp lệ
// ở đây; chuẩn hoá thật (phone → 0xxxxxxxxx, province → tên chuẩn) do createAddressSchema/
// updateAddressSchema làm ở phía BE.
export const addressFormSchema = z.object({
  recipientName: requiredText(
    100,
    'checkout.validationRecipientNameRequired',
    'checkout.validationRecipientNameTooLong',
  ),
  phone: z
    .string()
    .trim()
    .refine((value) => normalizeVietnamPhone(value) !== null, 'checkout.validationPhoneInvalid'),
  // Số nhà, đường/thôn.
  line1: requiredText(200, 'checkout.validationLine1Required', 'checkout.validationLine1TooLong'),
  // Xã/Phường/Đặc khu — nhập tự do (~3.300 đơn vị, không nhúng danh sách).
  ward: requiredText(100, 'checkout.validationWardRequired', 'checkout.validationWardTooLong'),
  province: z
    .string()
    .trim()
    .refine((value) => findProvince(value) !== null, 'checkout.validationProvinceInvalid'),
});
export type AddressFormInput = z.infer<typeof addressFormSchema>;

interface CanonicalizableAddress {
  phone?: string;
  province?: string;
}

// Đổi phone/province (nếu có) sang dạng lưu chuẩn. Đã qua validate nên tra không thể thất bại.
function canonicalize<T extends CanonicalizableAddress>(data: T): T {
  const result = { ...data };
  if (result.phone !== undefined) {
    result.phone = normalizeVietnamPhone(result.phone) ?? result.phone;
  }
  if (result.province !== undefined) {
    result.province = findProvince(result.province)?.name ?? result.province;
  }
  return result;
}

// POST /addresses — userId luôn lấy từ token, shopId luôn null (địa chỉ lấy hàng của shop chưa
// làm ở Tuần 7). Địa chỉ đầu tiên của user tự làm mặc định (service); đặt mặc định qua route riêng.
export const createAddressSchema = addressFormSchema.transform(canonicalize);
export type CreateAddressInput = z.infer<typeof createAddressSchema>;

// PATCH /addresses/:id — sửa 1 phần, ít nhất 1 field.
export const updateAddressSchema = addressFormSchema
  .partial()
  .refine((data) => Object.keys(data).length > 0, 'checkout.validationAddressUpdateEmpty')
  .transform(canonicalize);
export type UpdateAddressInput = z.infer<typeof updateAddressSchema>;

export const addressSchema = z.object({
  id: z.string(),
  recipientName: z.string(),
  phone: z.string(),
  line1: z.string(),
  ward: z.string(),
  province: z.string(),
  isDefault: z.boolean(),
  createdAt: z.string(),
});
export type Address = z.infer<typeof addressSchema>;

export const addressResponseSchema = z.object({ address: addressSchema });
export type AddressResponse = z.infer<typeof addressResponseSchema>;

export const addressListResponseSchema = z.object({ addresses: z.array(addressSchema) });
export type AddressListResponse = z.infer<typeof addressListResponseSchema>;
