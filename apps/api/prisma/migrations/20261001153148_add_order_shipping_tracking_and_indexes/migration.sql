-- DropIndex
DROP INDEX "orders_shop_id_idx";

-- DropIndex
DROP INDEX "orders_user_id_idx";

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "carrier" TEXT,
ADD COLUMN     "tracking_code" TEXT;

-- CreateIndex
CREATE INDEX "orders_user_id_created_at_idx" ON "orders"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "orders_shop_id_status_created_at_idx" ON "orders"("shop_id", "status", "created_at");
