-- CreateEnum
CREATE TYPE "OrderActorType" AS ENUM ('BUYER', 'SELLER', 'ADMIN', 'SYSTEM');

-- CreateTable
CREATE TABLE "order_status_histories" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "from_status" "OrderStatus",
    "to_status" "OrderStatus" NOT NULL,
    "actor_type" "OrderActorType" NOT NULL,
    "actor_id" TEXT,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_status_histories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "order_status_histories_order_id_created_at_idx" ON "order_status_histories"("order_id", "created_at");

-- AddForeignKey
ALTER TABLE "order_status_histories" ADD CONSTRAINT "order_status_histories_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: đơn đã có từ Tuần 7 chưa có timeline. Mọi đơn Tuần 7 đều được tạo ở AWAITING_PAYMENT
-- (placeOrder), nên ghi mốc tạo đơn (null -> AWAITING_PAYMENT) và, nếu đơn đã rời trạng thái đó,
-- 1 dòng chuyển sang trạng thái hiện tại (mốc thời gian lấy từ updated_at — xấp xỉ, không có dữ liệu
-- chính xác hơn). actor_type SYSTEM + note 'backfill' để phân biệt với dòng ghi thật sau này.
INSERT INTO "order_status_histories" ("id", "order_id", "from_status", "to_status", "actor_type", "note", "created_at")
SELECT gen_random_uuid()::text, "id", NULL, 'AWAITING_PAYMENT', 'SYSTEM', 'backfill', "created_at"
FROM "orders";

INSERT INTO "order_status_histories" ("id", "order_id", "from_status", "to_status", "actor_type", "note", "created_at")
SELECT gen_random_uuid()::text, "id", 'AWAITING_PAYMENT', "status", 'SYSTEM', 'backfill', "updated_at"
FROM "orders"
WHERE "status" <> 'AWAITING_PAYMENT';
