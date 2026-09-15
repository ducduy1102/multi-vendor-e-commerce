-- DropIndex
DROP INDEX "product_variants_sku_key";

-- AlterTable
ALTER TABLE "product_variants" ADD COLUMN "shop_id" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "product_variants_shop_id_idx" ON "product_variants"("shop_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_variants_shop_id_sku_key" ON "product_variants"("shop_id", "sku");

-- AddForeignKey
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;
