import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import type { Request } from 'express';

// Phương thức làm thay đổi dữ liệu. GET/HEAD/OPTIONS không bị chặn: theo quy ước chúng không có tác dụng phụ.
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Ba loại Content-Type mà MỘT FORM HTML (hay `fetch` với `no-cors`) của TRANG KHÁC được phép gửi mà trình duyệt
// KHÔNG phải hỏi trước (preflight CORS) — tức là những loại duy nhất kẻ tấn công dùng được để làm một lệnh ghi
// "ngầm" từ site của họ. Mọi loại khác (kể cả `application/json`) buộc trình duyệt gửi preflight, và preflight bị
// cấu hình CORS (chỉ cho các Origin của app) từ chối. Frontend của app chỉ gửi JSON và API không có route nào cần
// nhận form/multipart (ảnh tải thẳng lên Cloudinary bằng chữ ký), nên chặn hẳn ba loại này không mất tính năng nào.
const FORM_LIKE_MEDIA_TYPES = new Set([
  'application/x-www-form-urlencoded',
  'multipart/form-data',
  'text/plain',
]);

// Guard TOÀN CỤC (đăng ký bằng APP_GUARD ở AppModule). Lệnh ghi mang body dạng form ⇒ 415 trước khi tới handler, nên
// một form tự gửi từ site khác không thể gây tác dụng phụ ngay cả khi trình duyệt có đính kèm cookie (vd form từ
// một subdomain CÙNG site, nơi `SameSite=Lax` không chặn được). Đây là lớp phòng thủ nhỏ, KHÔNG thay thế việc kiểm
// `Origin`/token CSRF toàn diện (Tuần 12). Chỉ áp cho HTTP: sự kiện WebSocket đi qua cổng riêng đã kiểm `Origin`.
@Injectable()
export class RejectFormBodyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;

    const request = context.switchToHttp().getRequest<Request>();
    if (!WRITE_METHODS.has(request.method.toUpperCase())) return true;

    const mediaType = (request.headers['content-type'] ?? '')
      .split(';')[0]
      .trim()
      .toLowerCase();
    if (FORM_LIKE_MEDIA_TYPES.has(mediaType)) {
      throw new UnsupportedMediaTypeException(
        'Only application/json request bodies are accepted',
      );
    }
    return true;
  }
}
