-- CreateEnum
CREATE TYPE "ShopActorType" AS ENUM ('OWNER', 'ADMIN', 'SYSTEM');

-- AlterTable
ALTER TABLE "shops" ADD COLUMN     "status_changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "shop_status_histories" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "from_status" "ShopStatus",
    "to_status" "ShopStatus" NOT NULL,
    "actor_type" "ShopActorType" NOT NULL,
    "actor_id" TEXT,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shop_status_histories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "shop_status_histories_shop_id_created_at_idx" ON "shop_status_histories"("shop_id", "created_at");

-- CreateIndex
CREATE INDEX "shops_status_status_changed_at_idx" ON "shops"("status", "status_changed_at");

-- AddForeignKey
ALTER TABLE "shop_status_histories" ADD CONSTRAINT "shop_status_histories_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill 1/2: status_changed_at. Cột vừa thêm có DEFAULT CURRENT_TIMESTAMP nên mọi shop cũ đang mang
-- giờ chạy migration — nếu để nguyên, cả hàng chờ duyệt hiện có cùng 1 mốc và mất thứ tự FIFO.
--   - PENDING: created_at (chính xác — shop chưa từng đổi trạng thái, trước giờ không có cạnh nào dẫn về PENDING);
--   - trạng thái khác: updated_at (xấp xỉ — không có dữ liệu chính xác hơn).
UPDATE "shops"
SET "status_changed_at" = CASE WHEN "status" = 'PENDING' THEN "created_at" ELSE "updated_at" END;

-- Backfill 2/2: ShopStatusHistory — ghi ĐỦ đường đi đã qua của từng shop, không chỉ 1 dòng theo trạng thái
-- hiện tại, để "lý do từ chối lần trước" / "số lần nộp lại" ở danh sách Admin suy ra được từ history.
-- actor_type SYSTEM + actor_id NULL. note CHỈ chứa lý do thật (status_reason) ở dòng từ chối/khoá, còn lại
-- NULL — KHÔNG dùng chuỗi 'backfill' như order_status_histories: lastRejectionReason đọc thẳng note nên
-- admin sẽ thấy chữ "backfill" làm lý do. Dòng backfill phân biệt bằng actor_type = SYSTEM.
-- Thời điểm các dòng sau mốc tạo shop là xấp xỉ (updated_at / điểm giữa created_at và updated_at).

-- Mốc tạo shop: mọi shop đều được tạo ở PENDING.
INSERT INTO "shop_status_histories" ("id", "shop_id", "from_status", "to_status", "actor_type", "note", "created_at")
SELECT gen_random_uuid()::text, "id", NULL, 'PENDING', 'SYSTEM', NULL, "created_at"
FROM "shops";

-- Đã được duyệt: APPROVED (duyệt ~ status_changed_at) và SUSPENDED (từng được duyệt, thời điểm duyệt lấy
-- điểm giữa lúc tạo và lúc bị khoá để giữ đúng thứ tự dòng).
INSERT INTO "shop_status_histories" ("id", "shop_id", "from_status", "to_status", "actor_type", "note", "created_at")
SELECT gen_random_uuid()::text, "id", 'PENDING', 'APPROVED', 'SYSTEM', NULL,
       CASE WHEN "status" = 'APPROVED'
            THEN "status_changed_at"
            ELSE "created_at" + ("status_changed_at" - "created_at") / 2
       END
FROM "shops"
WHERE "status" IN ('APPROVED', 'SUSPENDED');

-- Bị từ chối: PENDING -> REJECTED kèm lý do hiện tại.
INSERT INTO "shop_status_histories" ("id", "shop_id", "from_status", "to_status", "actor_type", "note", "created_at")
SELECT gen_random_uuid()::text, "id", 'PENDING', 'REJECTED', 'SYSTEM', "status_reason", "status_changed_at"
FROM "shops"
WHERE "status" = 'REJECTED';

-- Đang bị khoá: APPROVED -> SUSPENDED kèm lý do hiện tại.
INSERT INTO "shop_status_histories" ("id", "shop_id", "from_status", "to_status", "actor_type", "note", "created_at")
SELECT gen_random_uuid()::text, "id", 'APPROVED', 'SUSPENDED', 'SYSTEM', "status_reason", "status_changed_at"
FROM "shops"
WHERE "status" = 'SUSPENDED';
