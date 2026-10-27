-- AlterTable
ALTER TABLE "users" ADD COLUMN     "status_changed_at" TIMESTAMP(3),
ADD COLUMN     "status_reason" VARCHAR(500);


-- Bất biến của cột lý do (Prisma không khai được CHECK trong schema.prisma). Lưới an toàn cuối cho mọi đường đi vòng qua
-- luồng khoá/mở của Admin; Zod (packages/types/src/admin-user.ts) vẫn kiểm trước khi ghi.
-- status_reason: NULL (chưa từng bị Admin đổi trạng thái, hoặc đã mở lại) hoặc 1..500 ký tự. Cận trên đã được VARCHAR(500) ép
-- và khớp ADMIN_USER_REASON_MAX_LENGTH ở packages/types; CHECK này thêm vào việc chặn chuỗi rỗng (khác NULL), thứ VARCHAR
-- không chặn. Không backfill: người dùng hiện có giữ cả hai cột NULL.
ALTER TABLE "users" ADD CONSTRAINT "users_status_reason_length_in_range" CHECK ("status_reason" IS NULL OR char_length("status_reason") BETWEEN 1 AND 500);
