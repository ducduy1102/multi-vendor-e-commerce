-- CreateEnum
CREATE TYPE "AdminNoteTargetType" AS ENUM ('USER', 'SHOP');

-- CreateTable
CREATE TABLE "admin_notes" (
    "id" TEXT NOT NULL,
    "target_type" "AdminNoteTargetType" NOT NULL,
    "target_id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT timezone('UTC'::text, clock_timestamp()),

    CONSTRAINT "admin_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "admin_notes_target_type_target_id_created_at_id_idx" ON "admin_notes"("target_type", "target_id", "created_at" DESC, "id" DESC);


-- Bất biến của hàng ghi chú (Prisma không khai được CHECK trong schema.prisma). Lưới an toàn cuối cho mọi đường đi vòng qua
-- AdminNotesService; service vẫn kiểm bằng Zod (packages/types/src/admin-note.ts) trước khi ghi.
-- Không có khoá ngoại tới users/shops có chủ đích: ghi chú về một tài khoản/shop đã bị xoá vẫn là dấu vết của quyết định đã qua
-- (cùng lý do của admin_audit_logs, xem comment ở schema.prisma).

-- 1) target_id: 1..64 ký tự (luôn là UUID 36 ký tự; DB chỉ chặn dữ liệu rác/phình to, Zod mới ép đúng dạng UUID).
ALTER TABLE "admin_notes" ADD CONSTRAINT "admin_notes_target_id_length_in_range" CHECK (char_length("target_id") BETWEEN 1 AND 64);

-- 2) author_id: 1..64 ký tự (cùng cách với target_id).
ALTER TABLE "admin_notes" ADD CONSTRAINT "admin_notes_author_id_length_in_range" CHECK (char_length("author_id") BETWEEN 1 AND 64);

-- 3) content: 1..1000 ký tự (khớp ADMIN_NOTE_CONTENT_MAX_LENGTH ở packages/types; admin-note-schemas.spec.ts so cận trên).
ALTER TABLE "admin_notes" ADD CONSTRAINT "admin_notes_content_length_in_range" CHECK (char_length("content") BETWEEN 1 AND 1000);


-- Bảng CHỈ THÊM ngay ở DB (không chỉ ở mã nguồn): UPDATE, DELETE và TRUNCATE đều bị từ chối. Mã nguồn có test quét không cho
-- phép sửa/xoá (admin-note-append-only.spec.ts), nhưng test đó chỉ chặn lỗi của lập trình viên; trigger này chặn cả câu SQL lẻ
-- và script bảo trì. Cùng cơ chế với admin_audit_logs (migration add_admin_audit_logs).
--
-- Lối thoát DUY NHẤT: cờ cấu hình CỤC BỘ TRONG TRANSACTION `app.allow_audit_cleanup = 'on'` — cùng MỘT cờ với nhật ký quản trị để
-- test dọn dữ liệu chỉ cần một cơ chế (set_config(..., true) hết hiệu lực khi transaction kết thúc, không rò sang kết nối khác
-- trong pool). Chỉ mã test dọn dữ liệu dùng nó (src/shared/testing/admin-audit-cleanup.ts); test quét mã nguồn cấm tên cờ này
-- xuất hiện ở mã chạy thật.
--
-- GIỚI HẠN đã biết: trigger KHÔNG chặn được người có quyền chủ sở hữu bảng (họ tắt được trigger hoặc tự đặt cờ). Chặn thật sự cần
-- role DB của ứng dụng chỉ có INSERT/SELECT trên bảng này — việc hạ tầng của Tuần 12.
CREATE FUNCTION "admin_notes_forbid_change"() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('app.allow_audit_cleanup', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    ELSIF TG_OP = 'UPDATE' THEN
      RETURN NEW;
    END IF;
    RETURN NULL; -- TRUNCATE (trigger mức câu lệnh, giá trị trả về bị bỏ qua)
  END IF;

  RAISE EXCEPTION 'admin_notes is append-only: % is not allowed', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER "admin_notes_no_update_delete"
BEFORE UPDATE OR DELETE ON "admin_notes"
FOR EACH ROW EXECUTE FUNCTION "admin_notes_forbid_change"();

CREATE TRIGGER "admin_notes_no_truncate"
BEFORE TRUNCATE ON "admin_notes"
FOR EACH STATEMENT EXECUTE FUNCTION "admin_notes_forbid_change"();
