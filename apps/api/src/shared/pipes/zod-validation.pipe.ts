import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { ZodSchema } from 'zod';

// Dùng cho DTO khai báo bằng Zod (rules/backend.md mục 2) thay vì class-validator.
// Áp dụng qua @UsePipes(new ZodValidationPipe(someSchema)) trên từng route.
@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodSchema) {}

  transform(value: unknown) {
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
