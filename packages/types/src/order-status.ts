import { z } from 'zod';

// Khớp enum OrderStatus của Prisma. AWAITING_PAYMENT = vừa đặt, chưa thanh toán; PENDING = ĐÃ
// thanh toán, chờ shop xác nhận (Week7.md 1.13).
export const orderStatusSchema = z.enum([
  'AWAITING_PAYMENT',
  'PENDING',
  'CONFIRMED',
  'PACKED',
  'SHIPPING',
  'COMPLETED',
  'CANCELLED',
  'REFUNDED',
]);
export type OrderStatus = z.infer<typeof orderStatusSchema>;

// Trạng thái Seller được thấy/hành động. Đơn chưa thanh toán TUYỆT ĐỐI không được lộ cho Seller
// (nếu không Seller sẽ xác nhận/giao hàng cho đơn chưa trả tiền). Mọi API/trang của Seller phải lọc
// theo hằng số này thay vì tự nhớ điều kiện `status` — Tuần 8 dùng lại.
export const ORDER_STATUSES_VISIBLE_TO_SELLER: readonly OrderStatus[] =
  orderStatusSchema.options.filter((status) => status !== 'AWAITING_PAYMENT');
