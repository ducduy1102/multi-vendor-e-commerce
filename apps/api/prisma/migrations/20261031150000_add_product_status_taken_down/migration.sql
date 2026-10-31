-- AlterEnum
-- Giá trị mới của enum phải được COMMIT trước khi dùng được (Postgres không cho dùng ngay trong cùng transaction), nên cột và CHECK
-- tham chiếu nó nằm ở migration kế tiếp `add_product_takedown_columns`.
ALTER TYPE "ProductStatus" ADD VALUE 'TAKEN_DOWN';
