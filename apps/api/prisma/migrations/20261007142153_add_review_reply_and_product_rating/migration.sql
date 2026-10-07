-- DropIndex
DROP INDEX "reviews_product_id_idx";

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "avg_rating" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "review_count" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "reviews" ADD COLUMN     "edited_at" TIMESTAMP(3),
ADD COLUMN     "seller_replied_at" TIMESTAMP(3),
ADD COLUMN     "seller_reply" VARCHAR(1000);

-- CreateIndex
CREATE INDEX "products_status_avg_rating_idx" ON "products"("status", "avg_rating");

-- CreateIndex
CREATE INDEX "reviews_product_id_created_at_idx" ON "reviews"("product_id", "created_at");

-- ====================================================================================================
-- Phần viết tay (Week9.md 2.1 #4): CHECK Prisma không biểu diễn được + backfill.
-- ====================================================================================================

-- Rating nguyên 1-5 và comment không quá 1000 ký tự (cùng giới hạn với Zod ở packages/types — DB là chốt
-- chặn cuối nếu có đường ghi nào lọt qua service).
ALTER TABLE "reviews"
  ADD CONSTRAINT "reviews_rating_check" CHECK ("rating" BETWEEN 1 AND 5);
ALTER TABLE "reviews"
  ADD CONSTRAINT "reviews_comment_length_check" CHECK ("comment" IS NULL OR char_length("comment") <= 1000);

-- Cột denormalized của Product luôn nằm trong miền hợp lệ.
ALTER TABLE "products"
  ADD CONSTRAINT "products_avg_rating_check" CHECK ("avg_rating" >= 0 AND "avg_rating" <= 5);
ALTER TABLE "products"
  ADD CONSTRAINT "products_review_count_check" CHECK ("review_count" >= 0);

-- Backfill: tính lại avg_rating/review_count từ các review đã có (cùng công thức ProductRatingService:
-- COUNT, AVG làm tròn 2 chữ số). Sản phẩm chưa có review giữ mặc định 0/0. Ở dev DB lúc viết migration
-- bảng reviews trống nên câu này không đổi dòng nào; vẫn giữ để môi trường đã có dữ liệu cũng đúng.
UPDATE "products" AS p
SET "review_count" = r."cnt",
    "avg_rating" = r."avg"
FROM (
  SELECT "product_id", COUNT(*)::int AS "cnt", ROUND(AVG("rating")::numeric, 2)::double precision AS "avg"
  FROM "reviews"
  GROUP BY "product_id"
) AS r
WHERE r."product_id" = p."id";
