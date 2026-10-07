-- CreateEnum
CREATE TYPE "RefundRequestKind" AS ENUM ('CANCEL', 'RETURN');

-- CreateEnum
CREATE TYPE "RefundRequestStatus" AS ENUM ('PENDING_SELLER', 'APPROVED', 'REJECTED_BY_SELLER', 'ESCALATED', 'REJECTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "PaymentRefundStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED');

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "refunded_amount" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "refund_requests" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "kind" "RefundRequestKind" NOT NULL,
    "status" "RefundRequestStatus" NOT NULL DEFAULT 'PENDING_SELLER',
    "reason_code" TEXT NOT NULL,
    "reason_note" VARCHAR(500),
    "seller_respond_by" TIMESTAMP(3) NOT NULL,
    "status_changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "refund_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refund_request_histories" (
    "id" TEXT NOT NULL,
    "refund_request_id" TEXT NOT NULL,
    "from_status" "RefundRequestStatus",
    "to_status" "RefundRequestStatus" NOT NULL,
    "actor_type" "OrderActorType" NOT NULL,
    "actor_id" TEXT,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refund_request_histories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_refunds" (
    "id" TEXT NOT NULL,
    "payment_id" TEXT NOT NULL,
    "order_id" TEXT,
    "refund_request_id" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "status" "PaymentRefundStatus" NOT NULL DEFAULT 'PENDING',
    "gateway_ref" TEXT,
    "failure_reason" VARCHAR(500),
    "reason" VARCHAR(500),
    "initiated_by_type" "OrderActorType" NOT NULL,
    "initiated_by_id" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_refunds_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "refund_requests_order_id_idx" ON "refund_requests"("order_id");

-- CreateIndex
CREATE INDEX "refund_requests_shop_id_status_created_at_idx" ON "refund_requests"("shop_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "refund_requests_user_id_created_at_idx" ON "refund_requests"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "refund_requests_status_seller_respond_by_idx" ON "refund_requests"("status", "seller_respond_by");

-- CreateIndex
CREATE INDEX "refund_request_histories_refund_request_id_created_at_idx" ON "refund_request_histories"("refund_request_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "payment_refunds_order_id_key" ON "payment_refunds"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_refunds_refund_request_id_key" ON "payment_refunds"("refund_request_id");

-- CreateIndex
CREATE INDEX "payment_refunds_payment_id_idx" ON "payment_refunds"("payment_id");

-- CreateIndex
CREATE INDEX "payment_refunds_status_updated_at_idx" ON "payment_refunds"("status", "updated_at");

-- AddForeignKey
ALTER TABLE "refund_requests" ADD CONSTRAINT "refund_requests_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refund_requests" ADD CONSTRAINT "refund_requests_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refund_requests" ADD CONSTRAINT "refund_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refund_request_histories" ADD CONSTRAINT "refund_request_histories_refund_request_id_fkey" FOREIGN KEY ("refund_request_id") REFERENCES "refund_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_refunds" ADD CONSTRAINT "payment_refunds_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_refunds" ADD CONSTRAINT "payment_refunds_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_refunds" ADD CONSTRAINT "payment_refunds_refund_request_id_fkey" FOREIGN KEY ("refund_request_id") REFERENCES "refund_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ====================================================================================================
-- Phần viết tay (Week9.md 2.1 #3): ràng buộc và chỉ mục Prisma không biểu diễn được. Prisma bỏ qua CHECK và
-- index có WHERE khi so sánh schema (tiền lệ: addresses_user_id_default_key), nên `migrate diff` vẫn báo
-- "No difference detected".
-- ====================================================================================================

-- Không bao giờ hoàn quá số đã thu: 0 <= refunded_amount <= amount. Cùng kiểu CHECK tồn kho (migration
-- add_variant_reserved_stock_and_checks) — chốt chặn thứ hai sau câu UPDATE có điều kiện của RefundService
-- (`WHERE refunded_amount + :amount <= amount`).
ALTER TABLE "payments"
  ADD CONSTRAINT "payments_refunded_amount_check"
  CHECK ("refunded_amount" >= 0 AND "refunded_amount" <= "amount");

-- Mỗi dòng sổ cái là một khoản tiền thật (> 0) và số lần thử không âm.
ALTER TABLE "payment_refunds"
  ADD CONSTRAINT "payment_refunds_amount_check" CHECK ("amount" > 0);
ALTER TABLE "payment_refunds"
  ADD CONSTRAINT "payment_refunds_attempts_check" CHECK ("attempts" >= 0);

-- Mỗi đơn tối đa MỘT yêu cầu mỗi loại (CANCEL/RETURN), trừ yêu cầu đã rút (WITHDRAWN) — nên đơn bị từ chối
-- hủy vẫn xin trả hàng được sau này, còn người mua rút rồi gửi lại được.
CREATE UNIQUE INDEX "refund_requests_order_id_kind_active_key"
  ON "refund_requests" ("order_id", "kind")
  WHERE "status" <> 'WITHDRAWN';

-- Hoàn thanh toán KHÔNG gắn đơn (order_id IS NULL: PAID_AFTER_EXPIRY, thanh toán trùng) — mỗi Payment chỉ
-- một dòng như vậy. (Dòng gắn đơn đã được unique theo order_id ở trên; NULL không bị unique đó chặn.)
CREATE UNIQUE INDEX "payment_refunds_payment_id_orphan_key"
  ON "payment_refunds" ("payment_id")
  WHERE "order_id" IS NULL;
