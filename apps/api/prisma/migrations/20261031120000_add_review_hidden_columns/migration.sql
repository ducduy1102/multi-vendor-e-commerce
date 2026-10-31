-- DropIndex
DROP INDEX "reviews_product_id_created_at_idx";

-- AlterTable
ALTER TABLE "reviews" ADD COLUMN     "hidden_at" TIMESTAMP(3),
ADD COLUMN     "hidden_by_id" TEXT,
ADD COLUMN     "hidden_reason" TEXT;

-- CreateIndex
CREATE INDEX "reviews_product_id_hidden_at_created_at_idx" ON "reviews"("product_id", "hidden_at", "created_at");


-- ====================================================================================================
-- Phần viết tay (Week11.md 5.5): ràng buộc Prisma không biểu diễn được. Prisma bỏ qua CHECK khi so sánh schema nên
-- `migrate diff --exit-code` vẫn báo "No difference detected". Lưới an toàn cuối cho mọi đường đi vòng qua ReviewService.
-- ====================================================================================================

-- Ẩn mềm đánh giá (D6): ba cột `hidden_*` hoặc cùng NULL (đánh giá đang hiển thị) hoặc cùng có giá trị (đã bị Admin ẩn). Đã ẩn thì phải
-- có người ẩn (id 1..64 ký tự, luôn là UUID 36 ký tự — DB chỉ chặn dữ liệu rác) và lý do 1..500 ký tự (khớp REVIEW_HIDDEN_REASON_MAX_LENGTH
-- ở packages/types; review-schemas.spec.ts so cận trên). Mở lại đặt cả ba về NULL. Một UPDATE bị bỏ dở (ẩn mà quên lý do/người ẩn) bị
-- DB từ chối thay vì để lại hàng nửa vời; mọi đánh giá có từ trước đều NULL cả ba nên đang hiển thị, không cần backfill.
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_hidden_columns_consistent" CHECK (
  ("hidden_at" IS NULL AND "hidden_by_id" IS NULL AND "hidden_reason" IS NULL)
  OR (
    "hidden_at" IS NOT NULL
    AND "hidden_by_id" IS NOT NULL AND char_length("hidden_by_id") BETWEEN 1 AND 64
    AND "hidden_reason" IS NOT NULL AND char_length("hidden_reason") BETWEEN 1 AND 500
  )
);
