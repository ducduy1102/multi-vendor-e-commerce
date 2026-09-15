/*
  Warnings:

  - Added the required column `max_price` to the `products` table without a default value. This is not possible if the table is not empty.
  - Added the required column `min_price` to the `products` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "products" ADD COLUMN     "max_price" DECIMAL(12,2) NOT NULL,
ADD COLUMN     "min_price" DECIMAL(12,2) NOT NULL;
