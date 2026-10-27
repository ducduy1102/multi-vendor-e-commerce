-- CreateTable
CREATE TABLE "admin_audit_logs" (
    "id" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,
    "reason" TEXT,
    "meta" JSONB NOT NULL DEFAULT '{}',
    "ip" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT timezone('UTC'::text, clock_timestamp()),

    CONSTRAINT "admin_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "admin_audit_logs_target_type_target_id_created_at_id_idx" ON "admin_audit_logs"("target_type", "target_id", "created_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "admin_audit_logs_actor_id_created_at_id_idx" ON "admin_audit_logs"("actor_id", "created_at" DESC, "id" DESC);


-- Bất biến của hàng nhật ký (Prisma không khai được CHECK trong schema.prisma). Lưới an toàn cuối cho mọi đường đi
-- vòng qua AdminAuditService; service vẫn kiểm bằng Zod (packages/types/src/admin-audit.ts) trước khi ghi.
-- Không có khoá ngoại tới users có chủ đích: nhật ký phải còn nguyên khi tài khoản bị xoá (xem comment ở schema.prisma).

-- 1) action: IN_HOA_GẠCH_DƯỚI, 1..64 ký tự (regex đã gồm cận độ dài). Danh sách đóng các hành động hợp lệ nằm ở
-- packages/types (ADMIN_AUDIT_ACTION_TARGETS) nên thêm hành động mới không cần migration.
ALTER TABLE "admin_audit_logs" ADD CONSTRAINT "admin_audit_logs_action_format" CHECK ("action" ~ '^[A-Z][A-Z0-9_]{0,63}$');

-- 2) target_type: IN_HOA_GẠCH_DƯỚI, 1..32 ký tự.
ALTER TABLE "admin_audit_logs" ADD CONSTRAINT "admin_audit_logs_target_type_format" CHECK ("target_type" ~ '^[A-Z][A-Z0-9_]{0,31}$');

-- 3) target_id: 1..64 ký tự (luôn là UUID 36 ký tự; DB chỉ chặn dữ liệu rác/phình to, Zod mới ép đúng dạng UUID).
ALTER TABLE "admin_audit_logs" ADD CONSTRAINT "admin_audit_logs_target_id_length_in_range" CHECK (char_length("target_id") BETWEEN 1 AND 64);

-- 4) reason: NULL (hành động không cần lý do) hoặc 1..500 ký tự (khớp ADMIN_AUDIT_REASON_MAX_LENGTH ở packages/types).
ALTER TABLE "admin_audit_logs" ADD CONSTRAINT "admin_audit_logs_reason_length_in_range" CHECK ("reason" IS NULL OR char_length("reason") BETWEEN 1 AND 500);

-- 5) meta: phải là JSON object (không phải mảng/chuỗi/số/null).
ALTER TABLE "admin_audit_logs" ADD CONSTRAINT "admin_audit_logs_meta_is_object" CHECK (jsonb_typeof("meta") = 'object');

-- 6) meta: tối đa 2048 byte. Zod giới hạn 1024 byte trên JSON gọn (ADMIN_AUDIT_META_MAX_BYTES); DB nới gấp đôi vì
-- jsonb::text chèn thêm dấu cách sau ':' và ',' nên dài hơn JSON gọn, và để "Zod cho qua mà CHECK từ chối" không bao
-- giờ xảy ra. Đổi hằng số ở packages/types thì xem lại cận này bằng một migration mới.
ALTER TABLE "admin_audit_logs" ADD CONSTRAINT "admin_audit_logs_meta_size_limit" CHECK (octet_length("meta"::text) <= 2048);

-- 7) ip: NULL hoặc 1..45 ký tự (IPv6 dạng chữ dài nhất, kể cả IPv4 ánh xạ). Zod mới ép đúng dạng địa chỉ IP.
ALTER TABLE "admin_audit_logs" ADD CONSTRAINT "admin_audit_logs_ip_length_in_range" CHECK ("ip" IS NULL OR char_length("ip") BETWEEN 1 AND 45);

-- 8) user_agent: NULL hoặc 1..256 ký tự (khớp ADMIN_AUDIT_USER_AGENT_MAX_LENGTH ở packages/types).
ALTER TABLE "admin_audit_logs" ADD CONSTRAINT "admin_audit_logs_user_agent_length_in_range" CHECK ("user_agent" IS NULL OR char_length("user_agent") BETWEEN 1 AND 256);


-- Bảng CHỈ THÊM ngay ở DB (không chỉ ở mã nguồn): UPDATE, DELETE và TRUNCATE đều bị từ chối. Mã nguồn có test quét không
-- cho phép sửa/xoá (admin-audit-append-only.spec.ts), nhưng test đó chỉ chặn lỗi của lập trình viên; trigger này chặn cả
-- câu SQL lẻ, script bảo trì và lỗi SQL injection thông thường.
--
-- Lối thoát DUY NHẤT: cờ cấu hình CỤC BỘ TRONG TRANSACTION `app.allow_audit_cleanup = 'on'` (set_config(..., true) — hết
-- hiệu lực khi transaction kết thúc, không rò sang kết nối khác trong pool). Chỉ mã test dọn dữ liệu dùng nó
-- (src/shared/testing/admin-audit-cleanup.ts); test quét mã nguồn cấm tên cờ này xuất hiện ở mã chạy thật.
--
-- GIỚI HẠN đã biết: trigger KHÔNG chặn được người có quyền chủ sở hữu bảng (họ tắt được trigger hoặc tự đặt cờ). Chặn thật
-- sự cần role DB của ứng dụng chỉ có INSERT/SELECT trên bảng này, hoặc đẩy nhật ký sang kho ghi-một-lần — việc hạ tầng
-- của Tuần 12.
CREATE FUNCTION "admin_audit_logs_forbid_change"() RETURNS trigger
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

  RAISE EXCEPTION 'admin_audit_logs is append-only: % is not allowed', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER "admin_audit_logs_no_update_delete"
BEFORE UPDATE OR DELETE ON "admin_audit_logs"
FOR EACH ROW EXECUTE FUNCTION "admin_audit_logs_forbid_change"();

CREATE TRIGGER "admin_audit_logs_no_truncate"
BEFORE TRUNCATE ON "admin_audit_logs"
FOR EACH STATEMENT EXECUTE FUNCTION "admin_audit_logs_forbid_change"();
