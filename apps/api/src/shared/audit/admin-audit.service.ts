import { Injectable } from '@nestjs/common';
import {
  adminAuditEntrySchema,
  type AdminAuditEntryInput,
} from '@ecommerce/types';
import type { TxClient } from '../prisma/tx-client';

// Client mà `record` cần: chỉ delegate của bảng nhật ký. Cả `tx` của một `$transaction` lẫn `PrismaService` đều thoả.
export type AdminAuditClient = Pick<TxClient, 'adminAuditLog'>;

// Mục nhật ký không qua được schema: lỗi lập trình (thêm hành động mà quên bảng, truyền sai loại đối tượng) chứ không
// phải lỗi người dùng nên là Error thường (⇒ 500), và thông điệp CHỈ mang đường dẫn + mã lỗi của Zod — không bao giờ
// giá trị đã truyền (lý do do Admin nhập có thể chứa chữ riêng tư; AllExceptionsFilter log cả thông điệp lẫn stack).
export class InvalidAdminAuditEntryError extends Error {
  constructor(issues: string) {
    super(`Invalid admin audit entry: ${issues}`);
    this.name = 'InvalidAdminAuditEntryError';
  }
}

// Bên GHI nhật ký quản trị (Week11.md 2.3, D4), đặt ở shared/ vì nhiều module nghiệp vụ (admin, report, product,
// review, chat...) cùng ghi và nó không thuộc nghiệp vụ riêng của module nào (rules/general.md mục 1).
//
// HỢP ĐỒNG với nơi gọi — NGƯỢC với thông báo (NotificationService):
//  - truyền `tx` của chính `$transaction` đang đổi dữ liệu để dòng nhật ký commit/rollback CÙNG thay đổi nghiệp vụ.
//    Nhật ký phải khớp dữ liệu: không có chuyện "đã khoá người dùng mà không có dấu vết" hay ngược lại. Chỉ truyền
//    `PrismaService` khi hành động không đổi dữ liệu nào (vd Admin đọc chat — ghi TRƯỚC khi đọc, Week11.md 6.1);
//  - `record` THROW khi mục sai hình dạng hoặc DB từ chối, không nuốt lỗi: nơi gọi để lỗi lan ra để transaction
//    rollback (hành động không có dấu vết thì không được xảy ra);
//  - chỉ THÊM: service này không có phương thức sửa/xoá và `admin-audit-append-only.spec.ts` quét toàn bộ mã nguồn.
@Injectable()
export class AdminAuditService {
  async record(
    client: AdminAuditClient,
    entry: AdminAuditEntryInput,
  ): Promise<void> {
    const parsed = adminAuditEntrySchema.safeParse(entry);
    if (!parsed.success) {
      throw new InvalidAdminAuditEntryError(
        parsed.error.issues
          .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.code}`)
          .join('; '),
      );
    }

    const {
      actorId,
      action,
      targetType,
      targetId,
      reason,
      meta,
      ip,
      userAgent,
    } = parsed.data;
    // Không truyền `createdAt`: giờ do đồng hồ DB đóng dấu (xem comment ở schema.prisma).
    await client.adminAuditLog.create({
      data: {
        actorId,
        action,
        targetType,
        targetId,
        reason: reason ?? null,
        meta: meta ?? {},
        ip: ip ?? null,
        userAgent: userAgent ?? null,
      },
      select: { id: true },
    });
  }
}
