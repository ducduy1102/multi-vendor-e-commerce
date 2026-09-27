-- AlterTable
ALTER TABLE "product_variants" ADD COLUMN     "reserved_stock" INTEGER NOT NULL DEFAULT 0;

-- Bất biến kho (Prisma không khai được CHECK trong schema.prisma): 0 <= reserved_stock <= stock.
-- Lưới an toàn cuối cho các câu UPDATE có điều kiện ở tầng service.
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_stock_non_negative" CHECK ("stock" >= 0);
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_reserved_stock_non_negative" CHECK ("reserved_stock" >= 0);
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_reserved_stock_within_stock" CHECK ("reserved_stock" <= "stock");
