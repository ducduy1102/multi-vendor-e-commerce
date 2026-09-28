import { addressFormSchema, type AddressFormInput } from '@ecommerce/types';

// Schema dùng chung FE-BE (packages/types) — input === output type sẵn (không transform, chỉ
// refine), zodResolver + useForm<AddressFormInput>() dùng thẳng được, không cần bọc lại như
// voucher.schema.ts (rules/frontend.md mục 4).
export { addressFormSchema };
export type { AddressFormInput };

export const EMPTY_ADDRESS_FORM_VALUES: AddressFormInput = {
  recipientName: '',
  phone: '',
  line1: '',
  ward: '',
  province: '',
};
