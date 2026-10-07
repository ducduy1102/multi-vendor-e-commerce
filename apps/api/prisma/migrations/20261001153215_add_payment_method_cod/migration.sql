-- AlterEnum
ALTER TYPE "PaymentMethod" ADD VALUE 'COD';

-- AlterTable
ALTER TABLE "payments" ALTER COLUMN "expires_at" DROP NOT NULL;
