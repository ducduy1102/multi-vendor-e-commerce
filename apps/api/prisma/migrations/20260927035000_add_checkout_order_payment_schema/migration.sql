-- AlterTable
-- Địa chỉ 2 cấp (Tỉnh/Thành - Xã/Phường/Đặc khu): cấp huyện đã chấm dứt hoạt động từ 01/07/2025.
-- Cả 2 bảng đều 0 dòng nên không mất dữ liệu.
ALTER TABLE "addresses" DROP COLUMN "district";

-- AlterTable
ALTER TABLE "checkout_groups" ADD COLUMN     "idempotency_key" TEXT;

-- AlterTable
-- Bảng 0 dòng nên thêm cột NOT NULL không cần default/backfill.
ALTER TABLE "order_items" ADD COLUMN     "image_url" TEXT,
ADD COLUMN     "product_name" TEXT NOT NULL,
ADD COLUMN     "sku" TEXT NOT NULL,
ADD COLUMN     "variant_label" TEXT;

-- AlterTable
ALTER TABLE "orders" DROP COLUMN "shipping_district",
ADD COLUMN     "discount_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
ALTER COLUMN "status" SET DEFAULT 'AWAITING_PAYMENT';

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "expires_at" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "paid_at" TIMESTAMP(3),
ADD COLUMN     "pay_url" TEXT,
ADD COLUMN     "txn_ref" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "voucher_usages" (
    "id" TEXT NOT NULL,
    "voucher_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "checkout_group_id" TEXT NOT NULL,
    "discount_amount" DECIMAL(12,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "released_at" TIMESTAMP(3),

    CONSTRAINT "voucher_usages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "voucher_usages_voucher_id_user_id_idx" ON "voucher_usages"("voucher_id", "user_id");

-- CreateIndex
CREATE INDEX "voucher_usages_checkout_group_id_idx" ON "voucher_usages"("checkout_group_id");

-- CreateIndex
CREATE UNIQUE INDEX "voucher_usages_voucher_id_checkout_group_id_key" ON "voucher_usages"("voucher_id", "checkout_group_id");

-- CreateIndex
CREATE UNIQUE INDEX "checkout_groups_user_id_idempotency_key_key" ON "checkout_groups"("user_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "payments_txn_ref_key" ON "payments"("txn_ref");

-- CreateIndex
CREATE INDEX "payments_status_expires_at_idx" ON "payments"("status", "expires_at");

-- AddForeignKey
ALTER TABLE "checkout_groups" ADD CONSTRAINT "checkout_groups_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voucher_usages" ADD CONSTRAINT "voucher_usages_voucher_id_fkey" FOREIGN KEY ("voucher_id") REFERENCES "vouchers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voucher_usages" ADD CONSTRAINT "voucher_usages_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voucher_usages" ADD CONSTRAINT "voucher_usages_checkout_group_id_fkey" FOREIGN KEY ("checkout_group_id") REFERENCES "checkout_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Ràng buộc Prisma không khai được trong schema.prisma — viết tay.

-- vouchers.used_count = số VoucherUsage chưa nhả; không âm và không vượt usage_limit (lưới an toàn cuối
-- sau câu UPDATE có điều kiện ở tầng service).
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_used_count_non_negative" CHECK ("used_count" >= 0);
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_used_count_within_limit" CHECK ("usage_limit" IS NULL OR "used_count" <= "usage_limit");

-- Mỗi user tối đa 1 địa chỉ mặc định (đổi mặc định phải bỏ mặc định cũ trước, trong cùng transaction).
CREATE UNIQUE INDEX "addresses_user_id_default_key" ON "addresses"("user_id") WHERE "is_default";

-- Đúng 1 trong user_id / shop_id có giá trị.
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_exactly_one_owner" CHECK (("user_id" IS NOT NULL) <> ("shop_id" IS NOT NULL));
