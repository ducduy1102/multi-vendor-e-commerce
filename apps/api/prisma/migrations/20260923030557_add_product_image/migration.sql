-- CreateTable
CREATE TABLE "product_images" (
    "id" TEXT NOT NULL,
    "variant_id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_images_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_images_variant_id_idx" ON "product_images"("variant_id");

-- AddForeignKey
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Week5.md Bước 1.3/2.12: migrate dữ liệu cũ TRƯỚC khi drop cột image_url —
-- mỗi variant có image_url không null -> 1 row ProductImage(position=0).
-- gen_random_uuid() có sẵn trong Postgres 16 core, không cần bật extension.
INSERT INTO "product_images" ("id", "variant_id", "url", "position", "created_at")
SELECT gen_random_uuid(), "id", "image_url", 0, CURRENT_TIMESTAMP
FROM "product_variants"
WHERE "image_url" IS NOT NULL;

-- AlterTable
ALTER TABLE "product_variants" DROP COLUMN "image_url";
