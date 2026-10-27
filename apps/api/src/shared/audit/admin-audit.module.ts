import { Module } from '@nestjs/common';
import { AdminAuditService } from './admin-audit.service';

// Bên ghi nhật ký quản trị dùng chung (Week11.md 2.3). Module nghiệp vụ import AdminAuditModule rồi inject
// AdminAuditService; service không giữ PrismaService mà nhận client (`tx` hoặc prisma) ở mỗi lần gọi `record`, nên module
// không có phụ thuộc nào.
@Module({
  providers: [AdminAuditService],
  exports: [AdminAuditService],
})
export class AdminAuditModule {}
