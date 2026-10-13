-- CreateEnum
CREATE TYPE "UserLocale" AS ENUM ('vi', 'en');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "locale" "UserLocale" NOT NULL DEFAULT 'vi';
