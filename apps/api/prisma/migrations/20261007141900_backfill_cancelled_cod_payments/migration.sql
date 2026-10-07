-- Backfill (Week9.md 1.2 / 2.1): Payment COD của nhóm bị hủy TOÀN BỘ trước đây kẹt PENDING mãi (chưa có
-- trạng thái "không thu" — settleCodPayment chỉ biết chuyển SUCCESS). Giờ có PaymentStatus.CANCELLED
-- (migration trước, tách riêng vì giá trị enum mới không dùng được trong cùng transaction), đánh dấu lại
-- các khoản COD đã đúng điều kiện đó: còn PENDING, nhóm có đơn, và MỌI đơn của nhóm đều CANCELLED.
-- Nhóm không có đơn nào bị bỏ qua có chủ đích (không có bằng chứng "đã hủy hết").
UPDATE "payments" AS p
SET "status" = 'CANCELLED'
WHERE p."method" = 'COD'
  AND p."status" = 'PENDING'
  AND EXISTS (
    SELECT 1 FROM "orders" AS o WHERE o."checkout_group_id" = p."checkout_group_id"
  )
  AND NOT EXISTS (
    SELECT 1 FROM "orders" AS o
    WHERE o."checkout_group_id" = p."checkout_group_id" AND o."status" <> 'CANCELLED'
  );
