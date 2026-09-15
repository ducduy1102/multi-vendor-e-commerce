-- DropIndex
DROP INDEX "products_category_id_idx";

-- DropIndex
DROP INDEX "products_shop_id_idx";

-- CreateIndex
CREATE INDEX "products_shop_id_status_idx" ON "products"("shop_id", "status");

-- CreateIndex
CREATE INDEX "products_category_id_status_idx" ON "products"("category_id", "status");
