// Thông điệp lỗi validate của schema dùng chung KHÔNG viết thẳng 1 ngôn ngữ mà
// là KEY i18n ổn định (vd 'auth.validationEmailInvalid') — FE dịch bằng
// next-intl, BE chỉ chuyển tiếp trong lỗi 400. zodResolver chỉ đưa `message`
// ra ngoài nên key phải nằm ngay trong `message`.
//
// Lỗi cần chèn giá trị động (vd tên thuộc tính bị lặp) mã hoá tham số vào
// cùng chuỗi: 'product.validationSkuDuplicate::{"sku":"A1"}'. Luôn tạo bằng
// validationMessage(), đọc lại bằng parseValidationMessage().
const PARAMS_SEPARATOR = '::';

export type ValidationMessageParams = Record<string, string | number>;

export function validationMessage(key: string, params?: ValidationMessageParams): string {
  return params ? `${key}${PARAMS_SEPARATOR}${JSON.stringify(params)}` : key;
}

export function parseValidationMessage(message: string): {
  key: string;
  params?: ValidationMessageParams;
} {
  const index = message.indexOf(PARAMS_SEPARATOR);
  if (index === -1) {
    return { key: message };
  }
  try {
    const params = JSON.parse(
      message.slice(index + PARAMS_SEPARATOR.length),
    ) as ValidationMessageParams;
    return { key: message.slice(0, index), params };
  } catch {
    return { key: message };
  }
}
