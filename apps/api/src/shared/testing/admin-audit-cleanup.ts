import type { Prisma, PrismaClient } from '@prisma/client';

// Dọn dòng nhật ký quản trị do test tạo ra. Bảng `admin_audit_logs` chỉ thêm ngay ở DB (trigger
// `admin_audit_logs_no_update_delete`, migration add_admin_audit_logs) nên một câu DELETE thường bị từ chối; trigger chỉ
// cho qua khi transaction đặt cờ CỤC BỘ `app.allow_audit_cleanup = 'on'`. Đây là NƠI DUY NHẤT (cùng các int-spec) được
// đặt cờ đó — `admin-audit-append-only.spec.ts` cấm tên cờ xuất hiện ở mã chạy thật.
//
// `set_config(..., true)` (is_local) ⇒ cờ hết hiệu lực khi transaction kết thúc, không rò sang kết nối khác trong pool; vì
// vậy bắt buộc đặt cờ và xoá trong CÙNG một transaction.
export async function deleteAdminAuditLogsForTests(
  prisma: PrismaClient,
  where: Prisma.AdminAuditLogWhereInput,
): Promise<number> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT set_config('app.allow_audit_cleanup', 'on', true)`;
    const { count } = await tx.adminAuditLog.deleteMany({ where });
    return count;
  });
}

// Cùng cơ chế cho ghi chú nội bộ của Admin (Week11.md 4.3): bảng `admin_notes` cũng chỉ thêm ngay ở DB (trigger
// `admin_notes_no_update_delete`) và dùng CHUNG MỘT cờ dọn dẹp, nên test dọn dữ liệu chỉ cần một cơ chế.
export async function deleteAdminNotesForTests(
  prisma: PrismaClient,
  where: Prisma.AdminNoteWhereInput,
): Promise<number> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT set_config('app.allow_audit_cleanup', 'on', true)`;
    const { count } = await tx.adminNote.deleteMany({ where });
    return count;
  });
}
