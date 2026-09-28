import { HttpException } from '@nestjs/common';
import type {
  ErrorCodeWithDetails,
  ErrorDetailsMap,
  ServerErrorCode,
} from '@ecommerce/types';

// `details` chỉ nhận (và bắt buộc) đúng hình dạng khai trong ErrorDetailsMap cho mã đó — sai hình
// dạng là lỗi `tsc`, không phải lỗi lúc chạy; mã không có details thì không truyền tham số thứ 4.
type DetailsArgs<C extends ServerErrorCode> = C extends ErrorCodeWithDetails
  ? [details: ErrorDetailsMap[C]]
  : [];

// Lỗi nghiệp vụ có mã máy đọc được (Week7.md 1.16). `message` giữ tiếng Anh như các lỗi cũ (để mọi
// nơi đang đọc `message` không vỡ); AllExceptionsFilter thêm `code`/`details` vào body.
export class AppException<
  C extends ServerErrorCode = ServerErrorCode,
> extends HttpException {
  readonly code: C;
  readonly details?: ErrorDetailsMap[ErrorCodeWithDetails];

  constructor(
    status: number,
    code: C,
    message: string,
    ...details: DetailsArgs<C>
  ) {
    super({ message, code, details: details[0] }, status);
    this.code = code;
    this.details = details[0];
  }
}
