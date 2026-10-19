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
    const clientError = isHttpException
      ? null
      : this.asExposedClientError(exception);

    const status = isHttpException
      ? exception.getStatus()
      : (clientError?.status ?? HttpStatus.INTERNAL_SERVER_ERROR);

    const message = isHttpException
      ? this.extractMessage(exception)
      : (clientError?.message ?? 'Đã có lỗi xảy ra, vui lòng thử lại sau');

    // Lỗi của client (vd body quá lớn) là việc bình thường, không phải sự cố của server nên không log; chỉ lỗi
    // thật sự không lường trước mới log stack.
    if (!isHttpException && !clientError) {
      this.logger.error(
        exception instanceof Error ? exception.stack : exception,
      );
    }

    response.status(status).json({
      success: false,
      data: null,
      message,
      ...(isHttpException ? this.extractCodeAndDetails(exception) : {}),
    });
  }

  // Lỗi 4xx do thư viện HTTP của Express ném RA NGOÀI Nest (body-parser: body quá lớn 413, charset lạ 415, request
  // bị huỷ giữa chừng 400...) là đối tượng theo kiểu `http-errors`, KHÔNG phải HttpException; Nest chỉ tự đổi
  // SyntaxError (JSON hỏng) thành 400. Không có nhánh này, chúng rơi xuống 500 và còn bị log stack mỗi lần (một cách
  // làm đầy log chỉ bằng cách gửi body lớn). Chỉ nhận khi đủ cả ba: status 4xx hợp lệ, `expose === true` (cờ do
  // chính http-errors đặt để đánh dấu "thông điệp này an toàn cho client") và có message dạng chuỗi — nên một lỗi bất
  // kỳ có thuộc tính `status` (vd lỗi HTTP client gọi dịch vụ ngoài) KHÔNG bao giờ bị đưa thông điệp ra response.
  private asExposedClientError(
    exception: unknown,
  ): { status: number; message: string } | null {
    if (typeof exception !== 'object' || exception === null) return null;
    const candidate = exception as {
      status?: unknown;
      statusCode?: unknown;
      expose?: unknown;
      message?: unknown;
    };
    const status = candidate.statusCode ?? candidate.status;
    if (
      candidate.expose !== true ||
      typeof candidate.message !== 'string' ||
      typeof status !== 'number' ||
      !Number.isInteger(status) ||
      status < 400 ||
      status > 499
    ) {
      return null;
    }
    return { status, message: candidate.message };
  }

  // Chỉ lỗi có mã (AppException) mới có thêm code/details; lỗi khác giữ body cũ y hệt.
  private extractCodeAndDetails(exception: HttpException): {
    code?: string;
    details?: unknown;
  } {
    const body = exception.getResponse();
    if (
      typeof body !== 'object' ||
      body === null ||
      !('code' in body) ||
      typeof body.code !== 'string'
    ) {
      return {};
    }
    const details = 'details' in body ? body.details : undefined;
    return details === undefined
      ? { code: body.code }
      : { code: body.code, details };
  }

  private extractMessage(exception: HttpException): string {
    const body = exception.getResponse();
    if (typeof body === 'string') return body;
    if (
      typeof body === 'object' &&
      body !== null &&
      'message' in body &&
      typeof body.message !== 'undefined'
    ) {
      const msg: unknown = body.message;
      if (Array.isArray(msg)) return msg.map(String).join('; ');
      if (typeof msg === 'string') return msg;
    }
    return exception.message;
  }
}
