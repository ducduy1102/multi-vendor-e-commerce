import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import type { ZodType, ZodTypeDef } from 'zod';

// Dùng cho DTO khai báo bằng Zod (rules/backend.md mục 2) thay vì class-validator.
// Áp dụng qua @Body(new ZodValidationPipe(someSchema)) trên từng route.
@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  // Input là `unknown`: pipe luôn nhận giá trị thô từ request nên không cần input == output. Schema có `.transform()` hoặc
  // `.default()` (vd query `unreadOnly` "true" → boolean) có kiểu input khác kiểu output vẫn dùng được mà không phải ép kiểu.
  constructor(private readonly schema: ZodType<T, ZodTypeDef, unknown>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      // Gộp thành 1 chuỗi để khớp response envelope { success, data, message }
      // — dự án chưa có field riêng cho lỗi validate theo từng field.
      const message = result.error.issues
        .map((issue) => `${issue.path.join('.') || 'value'}: ${issue.message}`)
        .join('; ');
      throw new BadRequestException(message);
    }
    return result.data;
  }
}
