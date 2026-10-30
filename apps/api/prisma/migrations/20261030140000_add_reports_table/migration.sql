-- CreateEnum
CREATE TYPE "ReportTargetType" AS ENUM ('REVIEW', 'CONVERSATION', 'SHOP', 'PRODUCT');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('OPEN', 'RESOLVED', 'DISMISSED');

-- CreateTable
CREATE TABLE "reports" (
    "id" TEXT NOT NULL,
    "reporter_id" TEXT NOT NULL,
    "target_type" "ReportTargetType" NOT NULL,
    "target_id" TEXT NOT NULL,
    "reason_code" TEXT NOT NULL,
    "note" TEXT,
    "status" "ReportStatus" NOT NULL DEFAULT 'OPEN',
    "snapshot" JSONB NOT NULL,
    "resolved_by_id" TEXT,
    "resolution_action" TEXT,
    "resolution_note" TEXT,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reports_status_created_at_id_idx" ON "reports"("status", "created_at", "id");

-- CreateIndex
CREATE INDEX "reports_resolved_at_id_idx" ON "reports"("resolved_at", "id");

-- CreateIndex
CREATE INDEX "reports_reporter_id_created_at_idx" ON "reports"("reporter_id", "created_at");

-- CreateIndex
CREATE INDEX "reports_target_type_target_id_status_idx" ON "reports"("target_type", "target_id", "status");


-- ====================================================================================================
-- Phần viết tay (Week11.md 5.2): ràng buộc và chỉ mục Prisma không biểu diễn được. Prisma bỏ qua CHECK và index có WHERE khi so sánh
-- schema (tiền lệ: addresses_user_id_default_key, refund_requests_order_id_kind_active_key) nên `migrate diff --exit-code` vẫn báo
-- "No difference detected". Lưới an toàn cuối cho mọi đường đi vòng qua module `report` / AdminReportsService; hai service vẫn kiểm
-- bằng Zod (packages/types/src/report.ts) trước khi ghi.
-- Không có khoá ngoại tới users/shops/products/reviews/conversations có chủ đích (xem comment ở schema.prisma): báo cáo về một đối tượng
-- đã bị xoá vẫn là dấu vết của việc đã xảy ra, và không có quan hệ ngược nào đưa danh tính người báo vào route phía người bị báo.
-- ====================================================================================================

-- Mỗi người chỉ có MỘT báo cáo ĐANG MỞ về một đối tượng (chống báo cáo spam cùng một thứ). Báo cáo đã đóng không chặn báo lại: sau khi
-- Admin bỏ qua, người ta vẫn báo lại được nếu có lý do mới. Lỗi P2002 của chỉ mục này (meta.modelName = 'Report') là REPORT_ALREADY_OPEN.
CREATE UNIQUE INDEX "reports_open_reporter_target_key" ON "reports"("reporter_id", "target_type", "target_id") WHERE "status" = 'OPEN';

-- 1) Các cột id: 1..64 ký tự (luôn là UUID 36 ký tự; DB chỉ chặn dữ liệu rác/phình to, Zod mới ép đúng dạng UUID).
ALTER TABLE "reports" ADD CONSTRAINT "reports_reporter_id_length_in_range" CHECK (char_length("reporter_id") BETWEEN 1 AND 64);
ALTER TABLE "reports" ADD CONSTRAINT "reports_target_id_length_in_range" CHECK (char_length("target_id") BETWEEN 1 AND 64);
ALTER TABLE "reports" ADD CONSTRAINT "reports_resolved_by_id_length_in_range" CHECK ("resolved_by_id" IS NULL OR char_length("resolved_by_id") BETWEEN 1 AND 64);

-- 2) reason_code / resolution_action: chuỗi dạng enum IN_HOA_GẠCH_DƯỚI, tối đa 40 ký tự (khớp META_ENUM_CODE của nhật ký quản trị).
-- KHÔNG liệt kê giá trị hợp lệ ở DB: bảng lý do theo loại và bảng hành động theo loại nằm ở packages/types để thêm mã không cần migration.
ALTER TABLE "reports" ADD CONSTRAINT "reports_reason_code_format" CHECK ("reason_code" ~ '^[A-Z][A-Z0-9_]{0,39}$');
ALTER TABLE "reports" ADD CONSTRAINT "reports_resolution_action_format" CHECK ("resolution_action" IS NULL OR "resolution_action" ~ '^[A-Z][A-Z0-9_]{0,39}$');

-- 3) note / resolution_note: null hoặc 1..500 ký tự (khớp REPORT_NOTE_MAX_LENGTH và REPORT_RESOLUTION_NOTE_MAX_LENGTH ở packages/types;
-- report-schemas.spec.ts so cận trên). Zod đếm đơn vị UTF-16 còn char_length đếm ký tự ⇒ Zod luôn chặt hơn hoặc bằng DB.
ALTER TABLE "reports" ADD CONSTRAINT "reports_note_length_in_range" CHECK ("note" IS NULL OR char_length("note") BETWEEN 1 AND 500);
ALTER TABLE "reports" ADD CONSTRAINT "reports_resolution_note_length_in_range" CHECK ("resolution_note" IS NULL OR char_length("resolution_note") BETWEEN 1 AND 500);

-- 4) snapshot: phải là JSON object (không phải mảng/chuỗi/số/null) và tối đa 8192 byte văn bản jsonb. Zod giới hạn 4096 byte trên JSON
-- gọn (REPORT_SNAPSHOT_MAX_BYTES); DB nới gấp đôi vì jsonb::text chèn thêm dấu cách sau ':' và ',' nên dài hơn JSON gọn, và để "Zod cho
-- qua mà CHECK từ chối" không bao giờ xảy ra (cùng cách notifications.data, admin_audit_logs.meta). Đây chỉ là chặn dữ liệu phình to
-- (không phải nơi quyết định hình dạng) — đổi hằng số ở packages/types thì xem lại cận này bằng một migration mới.
ALTER TABLE "reports" ADD CONSTRAINT "reports_snapshot_is_object" CHECK (jsonb_typeof("snapshot") = 'object');
ALTER TABLE "reports" ADD CONSTRAINT "reports_snapshot_size_limit" CHECK (octet_length("snapshot"::text) <= 8192);

-- 5) Trạng thái ↔ cột kết quả: còn OPEN thì chưa có người xử lý, hành động, ghi chú hay thời điểm; đã RESOLVED/DISMISSED thì phải có người
-- xử lý, hành động và thời điểm. Một UPDATE bị bỏ dở (đổi status mà quên cột kia) bị DB từ chối thay vì để lại hàng nửa vời.
ALTER TABLE "reports" ADD CONSTRAINT "reports_status_matches_resolution" CHECK (
  ("status" = 'OPEN' AND "resolved_by_id" IS NULL AND "resolved_at" IS NULL AND "resolution_action" IS NULL AND "resolution_note" IS NULL)
  OR ("status" IN ('RESOLVED', 'DISMISSED') AND "resolved_by_id" IS NOT NULL AND "resolved_at" IS NOT NULL AND "resolution_action" IS NOT NULL)
);

-- 6) Hành động ↔ trạng thái cuối (reportStatusForAction ở packages/types): bỏ qua (DISMISS) ⇒ DISMISSED, mọi hành động khác ⇒ RESOLVED.
ALTER TABLE "reports" ADD CONSTRAINT "reports_dismissed_iff_dismiss_action" CHECK (
  ("status" <> 'DISMISSED' OR "resolution_action" = 'DISMISS')
  AND ("status" <> 'RESOLVED' OR "resolution_action" <> 'DISMISS')
);

-- 7) Mọi hành động xử lý (khác bỏ qua) BẮT BUỘC có ghi chú: lý do đi vào nhật ký quản trị và cột lý do của hành động (reportActionRequiresNote).
ALTER TABLE "reports" ADD CONSTRAINT "reports_resolved_has_note" CHECK ("status" <> 'RESOLVED' OR "resolution_note" IS NOT NULL);

-- 8) Chọn lý do "Khác" (OTHER) thì BẮT BUỘC có mô tả của người báo: Admin không có gì để xét nếu cả lý do lẫn mô tả đều trống.
ALTER TABLE "reports" ADD CONSTRAINT "reports_other_reason_has_note" CHECK ("reason_code" <> 'OTHER' OR "note" IS NOT NULL);
