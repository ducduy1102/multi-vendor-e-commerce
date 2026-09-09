-- AlterTable
ALTER TABLE "product_variants" ADD COLUMN     "is_active" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "checkout_groups" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "checkout_groups_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "checkout_groups_user_id_idx" ON "checkout_groups"("user_id");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_checkout_group_id_fkey" FOREIGN KEY ("checkout_group_id") REFERENCES "checkout_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_checkout_group_id_fkey" FOREIGN KEY ("checkout_group_id") REFERENCES "checkout_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
