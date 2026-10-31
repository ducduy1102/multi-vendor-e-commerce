-- AlterTable
ALTER TABLE "products" ADD COLUMN     "taken_down_at" TIMESTAMP(3),
ADD COLUMN     "taken_down_by_id" TEXT,
ADD COLUMN     "taken_down_reason" TEXT;


-- ====================================================================================================
-- Phần viết tay (Week11.md 5.7): ràng buộc Prisma không biểu diễn được. Prisma bỏ qua CHECK khi so sánh schema nên
-- `migrate diff --exit-code` vẫn báo "No difference detected". Lưới an toàn cuối cho mọi đường đi vòng qua ProductModerationService.
-- ====================================================================================================

-- Gỡ sản phẩm vi phạm (D5): trạng thái TAKEN_DOWN khi và chỉ khi ba cột `taken_down_*` cùng có giá trị. Đã gỡ thì phải có người gỡ (id
-- 1..64 ký tự, luôn là UUID 36 ký tự — DB chỉ chặn dữ liệu rác) và lý do 1..500 ký tự (khớp PRODUCT_TAKEDOWN_REASON_MAX_LENGTH ở
-- packages/types; product-schemas.spec.ts so cận trên). Khôi phục đặt cả ba về NULL. Một UPDATE bị bỏ dở (đổi trạng thái mà quên cột, hoặc
-- còn sót cột khi đã đổi trạng thái khác) bị DB từ chối thay vì để lại hàng nửa vời; mọi sản phẩm có từ trước đều không ở TAKEN_DOWN và
-- cả ba cột NULL nên không cần backfill.
ALTER TABLE "products" ADD CONSTRAINT "products_takedown_columns_consistent" CHECK (
  (
    "status" = 'TAKEN_DOWN'
    AND "taken_down_at" IS NOT NULL
    AND "taken_down_by_id" IS NOT NULL AND char_length("taken_down_by_id") BETWEEN 1 AND 64
    AND "taken_down_reason" IS NOT NULL AND char_length("taken_down_reason") BETWEEN 1 AND 500
  )
  OR (
    "status" <> 'TAKEN_DOWN'
    AND "taken_down_at" IS NULL AND "taken_down_by_id" IS NULL AND "taken_down_reason" IS NULL
  )
);
