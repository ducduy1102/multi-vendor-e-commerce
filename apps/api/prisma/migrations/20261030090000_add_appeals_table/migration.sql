-- CreateEnum
CREATE TYPE "AppealTargetType" AS ENUM ('SHOP', 'PRODUCT');

-- CreateEnum
CREATE TYPE "AppealStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED');

-- CreateTable
CREATE TABLE "appeals" (
    "id" TEXT NOT NULL,
    "target_type" "AppealTargetType" NOT NULL,
    "target_id" TEXT NOT NULL,
    "appellant_id" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" "AppealStatus" NOT NULL DEFAULT 'PENDING',
    "moderation_event_at" TIMESTAMP(3) NOT NULL,
    "decided_by_id" TEXT,
    "decision_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" TIMESTAMP(3),

    CONSTRAINT "appeals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "appeals_status_created_at_idx" ON "appeals"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "appeals_target_type_target_id_moderation_event_at_key" ON "appeals"("target_type", "target_id", "moderation_event_at");


-- Bất biến của hàng kháng nghị (Prisma không khai được CHECK trong schema.prisma). Lưới an toàn cuối cho mọi đường đi vòng qua
-- AppealService / AdminAppealService; hai service vẫn kiểm bằng Zod (packages/types/src/appeal.ts) trước khi ghi.
-- Không có khoá ngoại tới users/shops có chủ đích (xem comment ở schema.prisma): kháng nghị về một shop đã bị xoá vẫn là dấu vết
-- của quyết định đã qua.

-- 1) Các cột id: 1..64 ký tự (luôn là UUID 36 ký tự; DB chỉ chặn dữ liệu rác/phình to, Zod mới ép đúng dạng UUID).
ALTER TABLE "appeals" ADD CONSTRAINT "appeals_target_id_length_in_range" CHECK (char_length("target_id") BETWEEN 1 AND 64);
ALTER TABLE "appeals" ADD CONSTRAINT "appeals_appellant_id_length_in_range" CHECK (char_length("appellant_id") BETWEEN 1 AND 64);
ALTER TABLE "appeals" ADD CONSTRAINT "appeals_decided_by_id_length_in_range" CHECK ("decided_by_id" IS NULL OR char_length("decided_by_id") BETWEEN 1 AND 64);

-- 2) message: 1..1000 ký tự (khớp APPEAL_MESSAGE_MAX_LENGTH ở packages/types; appeal-schemas.spec.ts so cận trên).
ALTER TABLE "appeals" ADD CONSTRAINT "appeals_message_length_in_range" CHECK (char_length("message") BETWEEN 1 AND 1000);

-- 3) decision_note: null hoặc 1..500 ký tự (khớp APPEAL_DECISION_NOTE_MAX_LENGTH).
ALTER TABLE "appeals" ADD CONSTRAINT "appeals_decision_note_length_in_range" CHECK ("decision_note" IS NULL OR char_length("decision_note") BETWEEN 1 AND 500);

-- 4) Trạng thái ↔ cột quyết định: còn PENDING thì chưa có người quyết định, thời điểm hay ghi chú; đã ACCEPTED/REJECTED thì phải có
-- người quyết định và thời điểm. Một UPDATE bị bỏ dở (đổi status mà quên cột kia) bị DB từ chối thay vì để lại hàng nửa vời.
ALTER TABLE "appeals" ADD CONSTRAINT "appeals_status_matches_decision" CHECK (
  ("status" = 'PENDING' AND "decided_by_id" IS NULL AND "decided_at" IS NULL AND "decision_note" IS NULL)
  OR ("status" IN ('ACCEPTED', 'REJECTED') AND "decided_by_id" IS NOT NULL AND "decided_at" IS NOT NULL)
);

-- 5) Từ chối BẮT BUỘC có ghi chú (chủ shop đọc được lý do này).
ALTER TABLE "appeals" ADD CONSTRAINT "appeals_rejection_has_note" CHECK ("status" <> 'REJECTED' OR "decision_note" IS NOT NULL);
