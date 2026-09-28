-- AlterEnum
-- Postgres không cho dùng giá trị enum vừa thêm trong cùng transaction (kể cả để đặt DEFAULT),
-- nên việc đổi default của orders.status sang AWAITING_PAYMENT nằm ở migration kế tiếp.
ALTER TYPE "OrderStatus" ADD VALUE 'AWAITING_PAYMENT' BEFORE 'PENDING';
