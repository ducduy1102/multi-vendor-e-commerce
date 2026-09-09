import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface ApiSuccessResponse<T> {
  success: true;
  data: T;
}

// Bọc mọi response thành công theo convention { success, data, message }
// (rules/backend.md mục 3) — đăng ký global ở main.ts, controller không tự
// bọc response thủ công.
@Injectable()
export class TransformResponseInterceptor<T>
  implements NestInterceptor<T, ApiSuccessResponse<T>>
{
  intercept(
    _context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<ApiSuccessResponse<T>> {
    return next.handle().pipe(map((data) => ({ success: true, data })));
  }
}
