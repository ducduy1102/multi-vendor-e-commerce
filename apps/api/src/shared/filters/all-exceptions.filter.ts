import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';

// Chuẩn hoá MỌI lỗi (kể cả lỗi hệ thống không lường trước) về cùng format
// { success, data: null, message } — đăng ký global ở main.ts.
// Lỗi 500 không lộ chi tiết ra response, chỉ log ở server (checklist RESTful
// mục 11 trong skills/scaffold-backend-module).
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    const isHttpException = exception instanceof HttpException;

    const status = isHttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;

    const message = isHttpException
      ? this.extractMessage(exception)
      : 'Đã có lỗi xảy ra, vui lòng thử lại sau';

    if (!isHttpException) {
      this.logger.error(
        exception instanceof Error ? exception.stack : exception,
      );
    }

    response.status(status).json({ success: false, data: null, message });
  }

  private extractMessage(exception: HttpException): string {
    const body = exception.getResponse();
    if (typeof body === 'string') return body;
    if (
      typeof body === 'object' &&
      body !== null &&
      'message' in body &&
      typeof (body as { message: unknown }).message !== 'undefined'
    ) {
      const msg = (body as { message: unknown }).message;
      return Array.isArray(msg) ? msg.join('; ') : String(msg);
    }
    return exception.message;
  }
}
